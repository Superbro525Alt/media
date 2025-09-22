# app.py
# FastAPI tagger that calls a local Ollama vision model and returns structured JSON
# (dynamic, free-form tags/topics — no fixed taxonomy).
#
# Run:
#   uvicorn app:app --host 0.0.0.0 --port 8000
#
# Env vars:
#   OLLAMA_URL   (default http://localhost:11434)
#   MODEL_NAME   (default llava:13b)   # qwen2.5-vl often excels at OCR/diagrams
#   MAX_FRAMES   (default 8)
#   REQ_TIMEOUTS (seconds, default 600)

import os
import json
import re
from typing import List, Optional, Any, Dict

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ----------------- Config -----------------

OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL_NAME: str = os.getenv("MODEL_NAME", "llava:13b")
MAX_FRAMES: int = int(os.getenv("MAX_FRAMES", "8"))
REQ_TIMEOUTS: int = int(os.getenv("REQ_TIMEOUTS", "600"))

# ----------------- Schemas (match Rust) -----------------

class Suggested(BaseModel):
    rename: str = Field(default="")
    reason: str = Field(default="")
    confidence: float = Field(default=0.0)

class AiTagIn(BaseModel):
    # Identity
    name: str

    # Meta
    mime: Optional[str] = None
    size_bytes: Optional[int] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None

    # Type & numeric facts (informational only)
    file_type: str

    image_width: Optional[int] = None
    image_height: Optional[int] = None
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration_sec: Optional[float] = None
    video_fps: Optional[float] = None
    video_codec: Optional[str] = None
    pdf_page_count: Optional[int] = None

    # Real-media previews (raw base64 strings; NOT data URLs)
    image_b64: Optional[str] = None
    video_frames_b64: Optional[List[str]] = None
    pdf_page0_b64: Optional[str] = None

    # Seed keywords (optional)
    raw_keywords: List[str] = Field(default_factory=list)

class AiTagOut(BaseModel):
    tags: Optional[List[str]] = Field(default_factory=list)
    topics: Optional[List[str]] = Field(default_factory=list)
    raw_keywords: Optional[List[str]] = Field(default_factory=list)
    suggested: Optional[Suggested] = None

# ----------------- Prompt (dynamic, no fixed lists) -----------------

SYSTEM = """You are a media categorisation AI.

GOAL
Return a JSON object describing the media using:
- "tags": 3–8 short, free-form tags that describe the visual FORM and salient attributes. Examples of form tags (not exhaustive): photo, diagram, erd, flowchart, uml, chart, graph, table, spreadsheet, screenshot, slide, document_page, map, blueprint, poster.
- "topics": 1–4 short, free-form subject/domain topics about what it’s about (e.g., sports, golf, tournament, databases, data_modeling, schema_design). Do not limit yourself to examples; invent new ones when appropriate.
- "raw_keywords": 0–12 short keywords you infer from visible text or core concepts (lowercase).
- "suggested": { "rename": string, "reason": string, "confidence": 0..1 } — snake_case, keep extension if determinable, <= 80 chars.

RULES
1) Always cover BOTH axes:
   - at least ONE FORM-oriented tag (e.g., diagram/erd/flowchart/photo/…),
   - and at least ONE DOMAIN topic (e.g., golf/tournament/databases/…).
2) Prefer lowercase; use single words or kebab_case/snake_case; no spaces.
3) Do NOT invent or change numeric metadata (width/height/duration/pages) — they’re informational only.
4) Base decisions primarily on the provided pixels (and frames/pages). Ignore filename unless helpful.
6) The rename should reflect both the form and the subject when clear (e.g., golf_competition_entity_relationship_diagram.png).

OUTPUT
Return ONLY valid JSON with keys:
{"tags":[...], "topics":[...], "raw_keywords":[...], "suggested":{"rename":"...", "reason":"...", "confidence":0.0}}
"""

# ----------------- Utils -----------------

def force_json(s: str) -> Dict[str, Any]:
    """Try to parse strict JSON; if not, extract the first JSON object."""
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{(?:.|\n)*\}", s)
        if m:
            return json.loads(m.group(0))
        raise

def normalize_list(xs: Any) -> List[str]:
    if not isinstance(xs, list):
        return []
    out: List[str] = []
    seen = set()
    for x in xs:
        if not isinstance(x, str):
            continue
        y = x.strip().lower()
        if not y:
            continue
        if y not in seen:
            seen.add(y)
            out.append(y)
    return out

def strip_data_url(s: Optional[str]) -> Optional[str]:
    """If a data URL was provided, strip the prefix and return raw base64."""
    if s is None:
        return None
    if s.startswith("data:") and "," in s:
        return s.split(",", 1)[1]
    return s

def build_ctx_text(d: AiTagIn) -> str:
    return (
        f"file_type={d.file_type}\n"
        f"mime={d.mime}\n"
        f"size_bytes={d.size_bytes}\n"
        f"image_wh={d.image_width}x{d.image_height}\n"
        f"video_wh={d.video_width}x{d.video_height} dur={d.video_duration_sec}s fps={d.video_fps}\n"
        f"pdf_page_count={d.pdf_page_count}\n"
        f"seed_keywords={', '.join(d.raw_keywords)}\n"
        f"filename={d.name}\n"
        "Respond with JSON only."
    )

def call_ollama_vision(messages: List[Dict[str, Any]]) -> str:
    """Call Ollama /api/chat with a vision-capable model."""
    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.2},
    }
    r = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=REQ_TIMEOUTS)
    if not r.ok:
        raise RuntimeError(f"Ollama {r.status_code}: {r.text}")
    data = r.json()
    try:
        return data["message"]["content"]
    except Exception as e:
        raise RuntimeError(f"Unexpected Ollama response shape: {data}") from e

# ----------------- FastAPI app -----------------

app = FastAPI(title="Local AI Tagger (dynamic)", version="2.0.0")

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "ollama": OLLAMA_URL}

@app.post("/ai/tag", response_model=AiTagOut)
def tag(data: AiTagIn):
    # Build context text
    ctx = build_ctx_text(data)

    # Collect images (raw base64, no data URL headers)
    images: List[str] = []
    if data.image_b64:
        images.append(strip_data_url(data.image_b64) or "")
    if data.video_frames_b64:
        for b in data.video_frames_b64[:MAX_FRAMES]:
            images.append(strip_data_url(b) or "")
    if data.pdf_page0_b64:
        images.append(strip_data_url(data.pdf_page0_b64) or "")

    # Construct messages for Ollama. For llava / qwen2.5-vl, pass base64 via "images".
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": ctx, "images": images},
    ]

    try:
        raw = call_ollama_vision(messages)
        obj = force_json(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"vision model error: {e}")

    # Normalize result (lowercase + dedupe)
    tags = normalize_list(obj.get("tags", []))
    topics = normalize_list(obj.get("topics", []))
    extra_kw = normalize_list(obj.get("raw_keywords", []))

    suggested = None
    s_obj = obj.get("suggested")
    if isinstance(s_obj, dict):
        rename = str(s_obj.get("rename", ""))[:120]
        reason = str(s_obj.get("reason", ""))[:140]
        try:
            confidence = float(s_obj.get("confidence", 0.0))
        except Exception:
            confidence = 0.0
        suggested = Suggested(rename=rename, reason=reason, confidence=confidence)

    return AiTagOut(tags=tags, topics=topics, raw_keywords=extra_kw, suggested=suggested)
