//! analyse.rs — Local numeric metadata + real media previews to AI for tags/topics/rename.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};
use std::io::{Cursor, Read};
use std::time::SystemTime;

use mime_guess::MimeGuess;
use once_cell::sync::Lazy;
use regex::Regex;

use image::GenericImageView; // for .dimensions()
use crate::types::*;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

pub fn analyse_single(file: LoadedFile) -> Result<MediaAnalysis, tauri::Error> {
    // ---- Basic metadata
    let path = Path::new(&file.path);
    let mime = MimeGuess::from_path(path).first_raw().map(|s| s.to_string());

    let (size_bytes, created_at, modified_at) = fs::metadata(path)
        .ok()
        .map(|md| {
            (
                Some(md.len()),
                sys_time_to_rfc3339(md.created().ok()),
                sys_time_to_rfc3339(md.modified().ok()),
            )
        })
        .unwrap_or((None, None, None));

    // ---- Init output
    let mut out = MediaAnalysis::default();
    out.meta.mime = mime.clone();
    out.meta.size_bytes = size_bytes;
    out.meta.created_at = created_at;
    out.meta.modified_at = modified_at;

    // ---- File type
    let ftype = get_type(&file.name);
    out.meta.file_type = match ftype {
        FileType::Pdf => "pdf",
        FileType::Image => "image",
        FileType::Video => "video",
        FileType::Other => "other",
    }.to_string();

    // ---- Local numeric enrichment
    match ftype {
        FileType::Image => {
            enrich_image_dims(&file.path, &mut out);
            enrich_image_exif_keywords(&file.path, &mut out);
        }
        FileType::Video => {
            if let Err(e) = enrich_video_ffprobe(&file.path, &mut out) {
                eprintln!("[analyse] ffprobe failed: {e}");
            }
        }
        FileType::Pdf => {
            if let Err(e) = enrich_pdf_lopdf(&file.path, &mut out) {
                eprintln!("[analyse] pdf parse failed: {e}");
            }
        }
        FileType::Other => {}
    }

    // ---- Seed raw keywords from filename/EXIF
    let mut raw_keywords = gather_keywords(&file.name);
    // (EXIF push already done in enrich_image_exif_keywords)

    // ---- Build real-media previews for AI
    let previews = prepare_media_previews(&file, mime.as_deref())?;

    // ---- AI call: only for semantic fields
    if let Some(ai) = maybe_ai_enrichment(&file, &out, &raw_keywords, &previews) {
        if let Some(tags) = ai.tags { out.tagging.tags = tags; }
        if let Some(topics) = ai.topics { out.tagging.topics = topics; }
        if let Some(extra_kw) = ai.raw_keywords {
            for k in extra_kw {
                if !raw_keywords.iter().any(|x| x.eq_ignore_ascii_case(&k)) {
                    raw_keywords.push(k);
                }
            }
        }
        if let Some(s) = ai.suggested {
            if !s.rename.is_empty() {
                out.suggested = s;
            }
        }
    }

    out.tagging.raw_keywords = raw_keywords;
    Ok(out)
}


fn get_type(file_name: &str) -> FileType {
    match file_name.rsplit('.').next() {
        Some(ext) => match ext.to_lowercase().as_str() {
            "pdf" => FileType::Pdf,
            "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" => FileType::Image,
            "mp4" | "mov" | "avi" | "mkv" | "webm" => FileType::Video,
            _ => FileType::Other,
        },
        None => FileType::Other,
    }
}

// -----------------------------------------------------------------------------
// Common helpers
// -----------------------------------------------------------------------------

fn sys_time_to_rfc3339(ts: Option<SystemTime>) -> Option<String> {
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};
    ts.and_then(|t| OffsetDateTime::from(t).format(&Rfc3339).ok())
}

static SPLIT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^A-Za-z0-9]+").unwrap());
static STOP: Lazy<Vec<&'static str>> = Lazy::new(|| {
    vec!["the","a","an","and","or","of","to","in","on","for","with","by",
         "at","from","is","it","this","that","v","vs","final","copy","img",
         "photo","image","video","movie","clip","scan","page","pg","doc"]
});

fn gather_keywords(name: &str) -> Vec<String> {
    let mut v: Vec<String> = SPLIT_RE.split(name)
        .filter_map(|w| {
            let w = w.trim().to_lowercase();
            if w.len() >= 3 && !STOP.contains(&w.as_str()) { Some(w) } else { None }
        })
        .collect();
    v.sort();
    v.dedup();
    v
}

fn maybe_push_kw(keywords: &mut Vec<String>, s: &str) {
    for w in SPLIT_RE.split(s) {
        let w = w.trim().to_lowercase();
        if w.len() >= 3 && !STOP.contains(&w.as_str()) {
            if !keywords.iter().any(|k| k == &w) { keywords.push(w); }
        }
    }
}

// -----------------------------------------------------------------------------
// Image numeric
// -----------------------------------------------------------------------------

fn enrich_image_dims(path: &str, out: &mut MediaAnalysis) {
    if let Ok((w, h)) = image::image_dimensions(path) {
        out.image.width = Some(w);
        out.image.height = Some(h);
    }
}

fn enrich_image_exif_keywords(path: &str, out: &mut MediaAnalysis) {
    if let Ok(exif) = rexif::parse_file(path) {
        for entry in exif.entries {
            use rexif::ExifTag;
            match entry.tag {
                ExifTag::DateTimeOriginal => {
                    let dt_str = entry.value_more_readable.trim().to_string();
                    if !dt_str.is_empty() { out.image.exif_datetime = Some(dt_str); }
                }
                ExifTag::Make | ExifTag::Model => {
                    let s = entry.value_more_readable.to_lowercase();
                    if !s.is_empty() && !out.tagging.raw_keywords.iter().any(|k| k == &s) {
                        out.tagging.raw_keywords.push(s);
                    }
                }
                _ => {}
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Video numeric (ffprobe)
// -----------------------------------------------------------------------------

#[derive(Deserialize)]
struct FfStream { codec_type: Option<String>, codec_name: Option<String>, width: Option<u32>, height: Option<u32>, avg_frame_rate: Option<String> }
#[derive(Deserialize)]
struct FfFormat { duration: Option<String> }
#[derive(Deserialize)]
struct FfProbe { streams: Option<Vec<FfStream>>, format: Option<FfFormat> }

fn enrich_video_ffprobe(path: &str, out: &mut MediaAnalysis) -> anyhow::Result<()> {
    let ff = which::which("ffprobe").map_err(|_| anyhow::anyhow!("ffprobe not found"))?;
    let output = Command::new(ff)
        .args(["-v","quiet","-print_format","json","-show_format","-show_streams",path])
        .output()?;
    if !output.status.success() { return Err(anyhow::anyhow!("ffprobe failed")); }
    let parsed: FfProbe = serde_json::from_slice(&output.stdout)?;

    if let Some(fmt) = parsed.format {
        if let Some(d) = fmt.duration { if let Ok(secs) = d.parse::<f64>() { out.video.duration_sec = Some(secs); } }
    }
    if let Some(streams) = parsed.streams {
        if let Some(vs) = streams.iter().find(|s| s.codec_type.as_deref() == Some("video")) {
            out.video.codec  = vs.codec_name.clone();
            out.video.width  = vs.width;
            out.video.height = vs.height;
            if let Some(r) = &vs.avg_frame_rate { if let Some(fps) = parse_rational(r) { out.video.fps = Some(fps); } }
        }
    }
    Ok(())
}
fn parse_rational(s: &str) -> Option<f64> {
    let mut it = s.split('/');
    let a = it.next()?.parse::<f64>().ok()?;
    let b = it.next()?.parse::<f64>().ok()?;
    if b == 0.0 { None } else { Some(a / b) }
}

// -----------------------------------------------------------------------------
// PDF numeric (lopdf)
// -----------------------------------------------------------------------------

fn enrich_pdf_lopdf(path: &str, out: &mut MediaAnalysis) -> anyhow::Result<()> {
    let doc = lopdf::Document::load(path)?;
    let pages = doc.get_pages();
    out.pdf.page_count = Some(pages.len() as u32);
    if let Some((_, page_id)) = pages.into_iter().next() {
        if let Ok(page_dict) = doc.get_dictionary(page_id) {
            if let Ok(mb_obj) = page_dict.get(b"MediaBox") {
                if let lopdf::Object::Array(arr) = mb_obj {
                    if arr.len() == 4 {
                        let w = num_from_pdf(&arr[2])? - num_from_pdf(&arr[0])?;
                        let h = num_from_pdf(&arr[3])? - num_from_pdf(&arr[1])?;
                        out.pdf.page0_width_pt  = Some(w);
                        out.pdf.page0_height_pt = Some(h);
                    }
                }
            }
        }
    }
    Ok(())
}
fn num_from_pdf(obj: &lopdf::Object) -> anyhow::Result<f64> {
    match obj {
        lopdf::Object::Integer(i) => Ok(*i as f64),
        lopdf::Object::Real(f) => Ok(*f as f64),
        _ => Err(anyhow::anyhow!("not a number")),
    }
}

// -----------------------------------------------------------------------------
// Real-media previews for AI (actual pixels/frames/pages)
// -----------------------------------------------------------------------------

#[derive(Default, Serialize)]
struct MediaPreviews {
    image_b64: Option<String>,
    video_frames_b64: Option<Vec<String>>,
    pdf_page0_b64: Option<String>,
}

fn prepare_media_previews(file: &LoadedFile, mime: Option<&str>) -> Result<MediaPreviews, tauri::Error> {
    let lower = mime.unwrap_or("").to_lowercase();
    let ext = Path::new(&file.name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let is_image = lower.starts_with("image/") || matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp");
    let is_video = lower.starts_with("video/") || matches!(ext.as_str(), "mp4" | "mov" | "avi" | "mkv" | "webm");
    let is_pdf   = lower == "application/pdf" || ext == "pdf";

    let mut out = MediaPreviews::default();

    if is_image {
        out.image_b64 = Some(read_and_downscale_image_b64(&file.path, 2048)?); // real pixels; capped for bandwidth
    } else if is_video {
        out.video_frames_b64 = Some(extract_video_keyframes_b64(&file.path, 6)?); // real frames
    } else if is_pdf {
        out.pdf_page0_b64 = rasterize_pdf_page0_b64(&file.path)?; // real page pixels
    }

    Ok(out)
}

fn read_and_downscale_image_b64(path: &str, max_side: u32) -> Result<String, tauri::Error> {
    let img = image::open(path).map_err(|e| ioerr(format!("image open: {e}")))?;
    let (w, h) = img.dimensions();
    let (nw, nh) = if w.max(h) > max_side {
        if w >= h { (max_side, ((h as f32 * max_side as f32 / w as f32).round() as u32).max(1)) }
        else { (((w as f32 * max_side as f32 / h as f32).round() as u32).max(1), max_side) }
    } else { (w, h) };
    let small = img.resize_exact(nw, nh, image::imageops::FilterType::CatmullRom);

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    small.write_to(&mut cursor, image::ImageFormat::Png).map_err(|e| ioerr(format!("png encode: {e}")))?;
    Ok(base64::encode(buf))
}

fn extract_video_keyframes_b64(path: &str, max_frames: usize) -> Result<Vec<String>, tauri::Error> {
    let ffmpeg = match which::which("ffmpeg") {
        Ok(p) => p,
        Err(_) => return Ok(vec![]), // degrade quietly
    };
    let tmpdir = tempfile::tempdir().map_err(|e| ioerr(format!("tempdir: {e}")))?;
    let pattern = tmpdir.path().join("kf-%02d.jpg");

    // Grab ~1fps up to max_frames, scaled to ~512px width for sending
    let frames_arg = max_frames.to_string();
    let status = std::process::Command::new(ffmpeg)
        .args(["-y","-i",path,"-vf","fps=1,scale=512:-1"])
        .args(["-frames:v", &frames_arg])
        .arg(pattern.to_string_lossy().to_string())
        .status().map_err(|e| ioerr(format!("ffmpeg exec: {e}")))?;
    if !status.success() { return Ok(vec![]); }

    let mut frames = vec![];
    for entry in fs::read_dir(tmpdir.path()).map_err(|e| ioerr(format!("readdir: {e}")))? {
        let p = entry.map_err(|e| ioerr(format!("dirent: {e}")))?.path();
        if p.extension().and_then(|e| e.to_str()) == Some("jpg") {
            let bytes = fs::read(&p).map_err(|e| ioerr(format!("read frame: {e}")))?;
            frames.push(base64::encode(bytes));
        }
    }
    frames.sort();
    if frames.len() > max_frames { frames.truncate(max_frames); }
    Ok(frames)
}

fn rasterize_pdf_page0_b64(path: &str) -> Result<Option<String>, tauri::Error> {
    // Try `pdftoppm` if available. If missing, return None (the AI can still use filename + numeric fields).
    let pdftoppm = match which::which("pdftoppm") {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let tmpdir = tempfile::tempdir().map_err(|e| ioerr(format!("tempdir: {e}")))?;
    let prefix = tmpdir.path().join("p");
    let out_png = tmpdir.path().join("p-1.png");

    let status = std::process::Command::new(pdftoppm)
        .args(["-png","-f","1","-l","1"])
        .arg(path)
        .arg(prefix.to_string_lossy().to_string())
        .status().map_err(|e| ioerr(format!("pdftoppm exec: {e}")))?;
    if !status.success() || !out_png.exists() { return Ok(None); }

    let img = image::open(&out_png).map_err(|e| ioerr(format!("open raster: {e}")))?;
    let (w, h) = img.dimensions();
    let (nw, nh) = if w > 1400 { (1400u32, ((h as f32 * 1400.0 / w as f32).round() as u32).max(1)) } else { (w, h) };
    let small = img.resize_exact(nw, nh, image::imageops::FilterType::CatmullRom);

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    small.write_to(&mut cursor, image::ImageFormat::Png).map_err(|e| ioerr(format!("png encode: {e}")))?;
    Ok(Some(base64::encode(buf)))
}

// -----------------------------------------------------------------------------
// AI call (with real previews)
// -----------------------------------------------------------------------------

#[derive(Serialize)]
struct AiTagIn<'a> {
    // Identity
    name: &'a str,
    // Meta
    mime: Option<&'a str>,
    size_bytes: Option<u64>,
    created_at: Option<&'a str>,
    modified_at: Option<&'a str>,
    // Type & numeric facts (for context)
    file_type: &'a str,
    image_width: Option<u32>,
    image_height: Option<u32>,
    video_width: Option<u32>,
    video_height: Option<u32>,
    video_duration_sec: Option<f64>,
    video_fps: Option<f64>,
    video_codec: Option<&'a str>,
    pdf_page_count: Option<u32>,
    // Real media previews
    image_b64: Option<&'a str>,
    video_frames_b64: Option<&'a [String]>,
    pdf_page0_b64: Option<&'a str>,
    // Seed keywords
    raw_keywords: &'a [String],
}

#[derive(Deserialize)]
struct AiTagOut {
    #[serde(default)] tags: Option<Vec<String>>,
    #[serde(default)] topics: Option<Vec<String>>,
    #[serde(default)] raw_keywords: Option<Vec<String>>,
    #[serde(default)] suggested: Option<Suggested>,
}

fn maybe_ai_enrichment(
    file: &LoadedFile,
    m: &MediaAnalysis,
    raw_keywords: &Vec<String>,
    previews: &MediaPreviews,
) -> Option<AiTagOut> {
    println!("a");
    let endpoint = std::env::var("TAGGER_ENDPOINT").ok()?;
    println!("{}", endpoint);

    let req = AiTagIn {
        name: &file.name,
        mime: m.meta.mime.as_deref(),
        size_bytes: m.meta.size_bytes,
        created_at: m.meta.created_at.as_deref(),
        modified_at: m.meta.modified_at.as_deref(),
        file_type: &m.meta.file_type,
        image_width: m.image.width,
        image_height: m.image.height,
        video_width: m.video.width,
        video_height: m.video.height,
        video_duration_sec: m.video.duration_sec,
        video_fps: m.video.fps,
        video_codec: m.video.codec.as_deref(),
        pdf_page_count: m.pdf.page_count,
        image_b64: previews.image_b64.as_deref(),
        video_frames_b64: previews.video_frames_b64.as_deref(),
        pdf_page0_b64: previews.pdf_page0_b64.as_deref(),
        raw_keywords,
    };

    println!("{}", endpoint);

    let res = ureq::post(&endpoint).send_json(&req).ok()?;
    res.into_body().read_json::<AiTagOut>().ok()
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

fn ioerr<S: Into<String>>(s: S) -> tauri::Error {
    tauri::Error::from(std::io::Error::new(std::io::ErrorKind::Other, s.into()))
}
