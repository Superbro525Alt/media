use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};
use std::io::Read;
use std::time::SystemTime;
use mime_guess::MimeGuess;
use regex::Regex;
use once_cell::sync::Lazy;

#[macro_export]
macro_rules! analysis {
    ( $name:ident {
        $( $field_vis:vis $field:ident : $ty:ty ),* $(,)?
    }) => {
        #[derive(Debug, serde::Serialize, Default, serde::Deserialize)]
        pub struct $name {
            $( $field_vis $field: $ty ),*
        }
    };
}

pub enum FileType {
    Pdf,
    Image,
    Video,
    Other,
}

#[derive(Debug, Deserialize)]
pub struct LoadedFile {
    pub name: String,
    pub path: String,
}

analysis!(Metadata {
    pub file_type: String,
    pub mime: Option<String>,
    pub size_bytes: Option<u64>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
});

analysis!(Video {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_sec: Option<f64>,
    pub fps: Option<f64>,
    pub codec: Option<String>,
});

analysis!(PDF {
    pub page_count: Option<u32>,
    pub page0_width_pt: Option<f64>,
    pub page0_height_pt: Option<f64>,
});

analysis!(Image {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub exif_datetime: Option<String>,
    pub phash: Option<String>,
    pub dominant_colors: Vec<String>,
});

analysis!(Tagging {
    pub tags: Vec<String>,
    pub topics: Vec<String>,
    pub raw_keywords: Vec<String>,
});

analysis!(MediaAnalysis {
    pub meta: Metadata,
    pub video: Video,
    pub pdf: PDF,
    pub image: Image,
    pub tagging: Tagging,
    pub suggested: Suggested
});

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Suggested { pub rename: String, pub reason: String, pub confidence: f32 }
