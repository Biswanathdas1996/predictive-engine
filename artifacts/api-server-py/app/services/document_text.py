"""Extract plain text from uploaded policy documents (server-side)."""

from __future__ import annotations

import asyncio
from io import BytesIO
from pathlib import Path

_TEXT_EXTENSIONS = frozenset({".md", ".markdown", ".txt", ".text"})
_SUPPORTED_EXTENSIONS = frozenset({*_TEXT_EXTENSIONS, ".pdf", ".docx", ".doc"})


def _content_type_base(content_type: str | None) -> str:
    if not content_type:
        return ""
    return content_type.split(";", 1)[0].strip().lower()


def _sniff_text_or_markdown_bytes(data: bytes) -> str:
    """Return .md / .txt from UTF-8 content, or '' if not clearly text."""
    if not data:
        return ""
    if data.startswith(b"%PDF-") or data.startswith(b"PK\x03\x04"):
        return ""
    head = data[: min(len(data), 4096)]
    if b"\x00" in head:
        return ""
    try:
        sample = head.decode("utf-8-sig")
    except UnicodeDecodeError:
        return ""
    s = sample.lstrip("\ufeff \t\r\n")
    if s.startswith("#") or s.startswith("---") or s.lstrip().startswith("```"):
        return ".md"
    if s:
        sample2 = s[:2000]
        printable = sum(1 for c in sample2 if c.isprintable() or c in "\n\r\t")
        if printable / max(len(sample2), 1) > 0.85:
            return ".txt"
    return ""


def _guess_ext_from_metadata(content_type: str | None, data: bytes) -> str:
    ct = _content_type_base(content_type)
    if ct in ("text/markdown", "text/x-markdown", "application/markdown"):
        return ".md"
    if ct == "text/plain":
        return ".txt"
    # Windows / some browsers label .md as octet-stream; multipart often has no MIME
    if data and (ct == "application/octet-stream" or not ct):
        return _sniff_text_or_markdown_bytes(data)
    return ""


def normalized_filename_and_ext(
    filename: str | None,
    content_type: str | None,
    data: bytes,
) -> tuple[str, str]:
    """Return (display_name, extension) for routing; fixes missing/unknown extensions (common for .md on Windows)."""
    raw = (filename or "").strip()
    base = Path(raw).name if raw else ""
    if not base:
        base = "document"
    ext = Path(base).suffix.lower()
    if ext in _SUPPORTED_EXTENSIONS:
        return base, ext
    guessed = _guess_ext_from_metadata(content_type, data)
    if guessed:
        stem = Path(base).stem
        if not stem or stem == ".":
            stem = "document"
        return f"{stem}{guessed}", guessed
    return base, ext


def extract_text_sync(filename: str, data: bytes) -> str:
    if not data:
        return ""

    ext = Path(filename).suffix.lower()

    if ext in (".md", ".markdown", ".txt", ".text"):
        return data.decode("utf-8", errors="replace").strip()

    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(data))
        chunks: list[str] = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                chunks.append(t)
        return "\n".join(chunks).strip()

    if ext == ".docx":
        from docx import Document

        doc = Document(BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs if p.text).strip()

    if ext == ".doc":
        raise ValueError(
            "Legacy .doc is not supported. Save as .docx or export to PDF, then upload."
        )

    raise ValueError(f"Unsupported type '{ext}'. Use .pdf, .docx, .md, or .txt.")


async def extract_text_async(filename: str, data: bytes) -> str:
    return await asyncio.to_thread(extract_text_sync, filename, data)
