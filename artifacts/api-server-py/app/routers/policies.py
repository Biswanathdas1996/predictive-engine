import asyncio
import json
import logging
import re
from collections import defaultdict
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.db import pool
from app.serialize import policy_attachment_meta_row, policy_row
from app.services import document_text
from app.services import neo4j_service
from app.services import vertex_document

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_FILE_BYTES = 10 * 1024 * 1024
_MAX_SUMMARY_CHARS = 500_000

_MIME_FALLBACK = {
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".text": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _response_media_type(filename: str, stored: str | None) -> str:
    if stored and stored.strip():
        return stored.strip()
    ext = Path(filename).suffix.lower()
    return _MIME_FALLBACK.get(ext, "application/octet-stream")


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _ascii_fallback_filename(name: str) -> str:
    safe = re.sub(r'[^a-zA-Z0-9._-]+', "_", name).strip("._") or "document"
    return safe[:180]


def _content_disposition(filename: str, *, inline: bool = True) -> str:
    disp = "inline" if inline else "attachment"
    fallback = _ascii_fallback_filename(filename)
    enc = quote(filename, safe="")
    return f"{disp}; filename=\"{fallback}\"; filename*=UTF-8''{enc}"


async def _insert_policy(
    title: str,
    final_summary: str,
    *,
    attachments: list[tuple[str, str | None, bytes]] | None = None,
) -> dict:
    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO policies (title, summary) VALUES ($1, $2) RETURNING *",
                title,
                final_summary,
            )
            pid = row["id"]
            if attachments:
                for filename, content_type, body in attachments:
                    await conn.execute(
                        """INSERT INTO policy_attachments (policy_id, filename, content_type, body)
                           VALUES ($1, $2, $3, $4)""",
                        pid,
                        filename,
                        content_type,
                        body,
                    )
            att_rows = await conn.fetch(
                """SELECT id, policy_id, filename, content_type, octet_length(body) AS size
                   FROM policy_attachments WHERE policy_id = $1 ORDER BY id""",
                pid,
            )
    meta = [policy_attachment_meta_row(r) for r in att_rows]
    out = policy_row(row, attachments=meta)
    asyncio.create_task(neo4j_service.sync_policy_to_graph(out))
    return out


def _use_vertex(vertex_mode: str) -> bool:
    mode = (vertex_mode or "auto").strip().lower()
    if mode == "off":
        return False
    if mode == "on":
        return True
    return vertex_document.is_vertex_configured()


@router.get("/policies")
async def list_policies() -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM policies ORDER BY created_at DESC"
        )
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        att_rows = await conn.fetch(
            """SELECT id, policy_id, filename, content_type, octet_length(body) AS size
               FROM policy_attachments WHERE policy_id = ANY($1::int[]) ORDER BY policy_id, id""",
            ids,
        )
    by_pid: dict[int, list[dict]] = defaultdict(list)
    for ar in att_rows:
        by_pid[ar["policy_id"]].append(policy_attachment_meta_row(ar))
    return [policy_row(r, attachments=by_pid.get(r["id"], [])) for r in rows]


@router.get("/policies/{policy_id}/attachments/{attachment_id}")
async def get_policy_attachment(policy_id: int, attachment_id: int) -> Response:
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT filename, content_type, body FROM policy_attachments
               WHERE id = $1 AND policy_id = $2""",
            attachment_id,
            policy_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "Attachment not found"})
    fn = row["filename"] or "document"
    media = _response_media_type(fn, row["content_type"])
    body_raw = row["body"]
    if isinstance(body_raw, memoryview):
        body = body_raw.tobytes()
    elif isinstance(body_raw, bytes):
        body = body_raw
    else:
        body = bytes(body_raw)
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": _content_disposition(fn, inline=True)},
    )


@router.post("/policies", status_code=201)
async def create_policy(body: dict) -> dict:
    title = body.get("title")
    summary = body.get("summary")
    if not title or not summary:
        raise HTTPException(status_code=400, detail={"error": "title and summary required"})
    return await _insert_policy(title.strip(), summary)


@router.post("/policies/upload", status_code=201)
async def create_policy_upload(
    title: str = Form(..., min_length=1),
    summary: str = Form(""),
    files: list[UploadFile] = File(...),
    vertex_mode: str = Form("auto"),
) -> dict:
    """Create a policy with extracted text from PDF / DOCX / MD / TXT (plus optional summary)."""
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail={"error": "title required"})

    if not files:
        raise HTTPException(
            status_code=400,
            detail={"error": "At least one file is required for /policies/upload"},
        )

    mode = (vertex_mode or "auto").strip().lower()
    if mode == "on" and not vertex_document.is_vertex_configured():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "vertex_mode=on but Vertex AI is not configured (set GOOGLE_CLOUD_PROJECT and credentials)"
            },
        )

    use_v = _use_vertex(vertex_mode)
    parts: list[str] = []
    if summary and summary.strip():
        parts.append(summary.strip())

    upload_list = list(files)
    stored: list[tuple[str, str | None, bytes]] = []
    for uf in upload_list:
        raw = await uf.read()
        if len(raw) > _MAX_FILE_BYTES:
            label = (uf.filename or "upload").strip() or "upload"
            raise HTTPException(
                status_code=400,
                detail={"error": f"File {label!r} exceeds 10 MB limit"},
            )
        display_name, ext = document_text.normalized_filename_and_ext(
            uf.filename, uf.content_type, raw
        )
        stored.append((display_name, uf.content_type, raw))
        extracted = ""
        try:
            if use_v and ext == ".pdf":
                async for ev in vertex_document.iter_pdf_vertex(raw, display_name):
                    if ev.get("type") == "content":
                        extracted = ev.get("text") or ""
            elif use_v and ext in (".md", ".markdown", ".txt", ".text", ".docx"):
                if ext == ".docx":
                    extracted = await document_text.extract_text_async(display_name, raw)
                else:
                    extracted = raw.decode("utf-8", errors="replace").strip()
                merged = ""
                async for ev in vertex_document.iter_text_file_vertex(extracted, display_name):
                    if ev.get("type") == "content":
                        merged = ev.get("text") or ""
                extracted = merged
            else:
                extracted = await document_text.extract_text_async(display_name, raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        except Exception as exc:
            logger.exception("Policy upload processing failed for %s", display_name)
            raise HTTPException(
                status_code=502,
                detail={"error": f"Document processing failed: {exc!s}"},
            ) from exc

        if extracted:
            parts.append(f"### {display_name}\n\n{extracted}")
        elif raw:
            parts.append(
                f"### {display_name}\n\n_(No extractable text — empty or scanned PDF?)_"
            )

    final_summary = "\n\n---\n\n".join(parts).strip()
    if not final_summary:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Provide a written summary and/or at least one readable file (.pdf, .docx, .md, .txt)"
            },
        )

    if len(final_summary) > _MAX_SUMMARY_CHARS:
        final_summary = final_summary[: _MAX_SUMMARY_CHARS] + "\n\n…(truncated)"

    return await _insert_policy(title, final_summary, attachments=stored)


async def _extract_one_file_to_text(
    display_name: str,
    ext: str,
    raw: bytes,
    use_vertex: bool,
) -> AsyncIterator[dict]:
    """Yield status events; use normalized display_name/ext (fixes bare .md uploads from Windows)."""

    if use_vertex and ext == ".pdf":
        async for ev in vertex_document.iter_pdf_vertex(raw, display_name):
            yield ev
        return

    if use_vertex and ext in (".md", ".markdown", ".txt", ".text"):
        text = raw.decode("utf-8", errors="replace").strip()
        async for ev in vertex_document.iter_text_file_vertex(text, display_name):
            yield ev
        return

    if use_vertex and ext == ".docx":
        try:
            base = await document_text.extract_text_async(display_name, raw)
        except ValueError as exc:
            yield {"type": "error", "message": str(exc)}
            return
        async for ev in vertex_document.iter_text_file_vertex(base, display_name):
            yield ev
        return

    # Local extraction only
    yield {
        "type": "status",
        "file": display_name,
        "phase": "local",
        "page": 1,
        "total": 1,
        "message": "Extracting text locally…",
    }
    try:
        extracted = await document_text.extract_text_async(display_name, raw)
    except ValueError as exc:
        yield {"type": "error", "message": str(exc)}
        return
    yield {"type": "content", "file": display_name, "text": extracted or ""}


@router.post("/policies/upload-stream")
async def create_policy_upload_stream(
    title: str = Form(..., min_length=1),
    summary: str = Form(""),
    files: list[UploadFile] = File(...),
    vertex_mode: str = Form("auto"),
) -> StreamingResponse:
    """Same as /policies/upload but emits Server-Sent Events for page/section progress (Vertex AI)."""
    title_clean = title.strip()
    if not title_clean:
        raise HTTPException(status_code=400, detail={"error": "title required"})
    if not files:
        raise HTTPException(
            status_code=400,
            detail={"error": "At least one file is required"},
        )

    mode = (vertex_mode or "auto").strip().lower()
    if mode == "on" and not vertex_document.is_vertex_configured():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "vertex_mode=on but Vertex AI is not configured (set GOOGLE_CLOUD_PROJECT and credentials)"
            },
        )

    use_vertex = _use_vertex(vertex_mode)
    upload_list = list(files)

    async def event_stream() -> AsyncIterator[str]:
        parts: list[str] = []
        stored: list[tuple[str, str | None, bytes]] = []
        if summary and summary.strip():
            parts.append(summary.strip())

        try:
            yield _sse(
                {
                    "type": "status",
                    "phase": "start",
                    "message": "Upload received",
                    "vertex": use_vertex,
                    "model": vertex_document.vertex_model_id()
                    if use_vertex and vertex_document.is_vertex_configured()
                    else None,
                }
            )

            for uf in upload_list:
                raw = await uf.read()
                display_name, ext = document_text.normalized_filename_and_ext(
                    uf.filename, uf.content_type, raw
                )
                stored.append((display_name, uf.content_type, raw))
                if len(raw) > _MAX_FILE_BYTES:
                    yield _sse(
                        {
                            "type": "error",
                            "message": f"File {display_name!r} exceeds 10 MB limit",
                        }
                    )
                    return

                last_text = ""
                async for ev in _extract_one_file_to_text(
                    display_name, ext, raw, use_vertex
                ):
                    if ev.get("type") == "status":
                        yield _sse({"type": "status", **{k: v for k, v in ev.items() if k != "type"}})
                    elif ev.get("type") == "error":
                        yield _sse({"type": "error", "message": ev.get("message", "Unknown error")})
                        return
                    elif ev.get("type") == "content":
                        last_text = ev.get("text") or ""

                fn = display_name
                if last_text:
                    parts.append(f"### {fn}\n\n{last_text}")
                elif raw:
                    parts.append(
                        f"### {fn}\n\n_(No extractable text — empty or scanned PDF?)_"
                    )

            final_summary = "\n\n---\n\n".join(parts).strip()
            if not final_summary:
                yield _sse(
                    {
                        "type": "error",
                        "message": "Provide a written summary and/or at least one readable file",
                    }
                )
                return

            if len(final_summary) > _MAX_SUMMARY_CHARS:
                final_summary = final_summary[: _MAX_SUMMARY_CHARS] + "\n\n…(truncated)"

            yield _sse({"type": "status", "phase": "saving", "message": "Saving policy…"})
            policy = await _insert_policy(
                title_clean, final_summary, attachments=stored
            )
            yield _sse({"type": "complete", "policy": policy})
        except Exception as exc:
            logger.exception("upload-stream failed")
            yield _sse({"type": "error", "message": str(exc)})

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
