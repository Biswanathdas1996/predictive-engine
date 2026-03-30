"""Vertex AI Gemini: PDF page images + chunked text for other formats."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path

logger = logging.getLogger(__name__)

# Override with VERTEX_AI_MODEL; PwC / enterprise catalogs may use this id verbatim.
DEFAULT_VERTEX_MODEL = "gemini-2.5-flash-image"


def vertex_project() -> str | None:
    return (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCP_PROJECT") or "").strip() or None


def vertex_location() -> str:
    return (os.environ.get("VERTEX_AI_LOCATION") or "us-central1").strip()


def vertex_model_id() -> str:
    return (os.environ.get("VERTEX_AI_MODEL") or DEFAULT_VERTEX_MODEL).strip()


def is_vertex_configured() -> bool:
    return vertex_project() is not None


_initialized = False


def _ensure_vertex_init() -> None:
    global _initialized
    if _initialized:
        return
    proj = vertex_project()
    if not proj:
        raise RuntimeError("Vertex AI requires GOOGLE_CLOUD_PROJECT or GCP_PROJECT")
    import vertexai

    vertexai.init(project=proj, location=vertex_location())
    _initialized = True
    logger.info("Vertex AI initialized (location=%s, model=%s)", vertex_location(), vertex_model_id())


def _generative_model():
    _ensure_vertex_init()
    from vertexai.generative_models import GenerativeModel

    return GenerativeModel(vertex_model_id())


def _render_pdf_pages_png(pdf_bytes: bytes) -> list[bytes]:
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pngs: list[bytes] = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            w, h = page.rect.width, page.rect.height
            max_side = max(w, h) or 1.0
            zoom = min(2.0, 1600 / max_side)
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pngs.append(pix.tobytes("png"))
    finally:
        doc.close()
    return pngs


def _gemini_image_page(png_bytes: bytes, filename: str, page_1based: int, total: int) -> str:
    from vertexai.generative_models import GenerationConfig, Part

    model = _generative_model()
    prompt = (
        f"Transcribe document page {page_1based} of {total} from file {filename!r}. "
        "Extract every readable word in natural reading order. Plain UTF-8 text only; "
        "use blank lines between paragraphs. "
        "If there is no text on this page, reply exactly: (no text)"
    )
    cfg = GenerationConfig(max_output_tokens=8192, temperature=0.1)
    resp = model.generate_content(
        [Part.from_data(data=png_bytes, mime_type="image/png"), prompt],
        generation_config=cfg,
    )
    if not resp.candidates:
        return ""
    parts_out: list[str] = []
    for p in resp.candidates[0].content.parts:
        if getattr(p, "text", None):
            parts_out.append(p.text)
    return "\n".join(parts_out).strip()


def _gemini_text_chunk(
    chunk: str,
    filename: str,
    part_idx: int,
    total_parts: int,
) -> str:
    from vertexai.generative_models import GenerationConfig

    model = _generative_model()
    prompt = (
        f"You are extracting policy document text from {filename!r} "
        f"(section {part_idx} of {total_parts}). "
        "Return clean plain text: preserve structure (headings, lists) where obvious; "
        "do not add commentary. If the excerpt is empty noise, return (no text).\n\n"
        "---\n"
        f"{chunk}"
    )
    cfg = GenerationConfig(max_output_tokens=8192, temperature=0.1)
    resp = model.generate_content(prompt, generation_config=cfg)
    if not resp.candidates:
        return ""
    parts_out: list[str] = []
    for p in resp.candidates[0].content.parts:
        if getattr(p, "text", None):
            parts_out.append(p.text)
    return "\n".join(parts_out).strip()


def _chunk_text(text: str, max_chars: int = 10_000) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


async def iter_pdf_vertex(pdf_bytes: bytes, filename: str) -> AsyncIterator[dict]:
    """Yield status dicts; final yield is {type: 'content', file, text}."""
    pngs = await asyncio.to_thread(_render_pdf_pages_png, pdf_bytes)
    n = len(pngs)
    if n == 0:
        yield {
            "type": "status",
            "file": filename,
            "phase": "vertex_pdf",
            "page": 0,
            "total": 0,
            "message": "PDF has no pages",
        }
        yield {"type": "content", "file": filename, "text": ""}
        return

    pieces: list[str] = []
    for i, png in enumerate(pngs):
        yield {
            "type": "status",
            "file": filename,
            "phase": "vertex_pdf",
            "page": i + 1,
            "total": n,
            "message": f"Vertex AI ({vertex_model_id()}): page {i + 1}/{n}",
        }
        try:
            t = await asyncio.to_thread(_gemini_image_page, png, filename, i + 1, n)
        except Exception:
            logger.exception("Vertex page %s failed for %s", i + 1, filename)
            raise
        if t and t != "(no text)":
            pieces.append(t)

    yield {"type": "content", "file": filename, "text": "\n\n".join(pieces).strip()}


async def iter_text_file_vertex(text: str, filename: str) -> AsyncIterator[dict]:
    """Chunked Gemini text pass for md/txt/docx-derived text."""
    chunks = _chunk_text(text)
    if not chunks:
        yield {"type": "content", "file": filename, "text": ""}
        return

    total = len(chunks)
    pieces: list[str] = []
    for idx, chunk in enumerate(chunks):
        yield {
            "type": "status",
            "file": filename,
            "phase": "vertex_text",
            "page": idx + 1,
            "total": total,
            "message": f"Vertex AI ({vertex_model_id()}): section {idx + 1}/{total}",
        }
        try:
            t = await asyncio.to_thread(_gemini_text_chunk, chunk, filename, idx + 1, total)
        except Exception:
            logger.exception("Vertex text chunk %s failed for %s", idx + 1, filename)
            raise
        if t and t != "(no text)":
            pieces.append(t)

    yield {"type": "content", "file": filename, "text": "\n\n".join(pieces).strip()}
