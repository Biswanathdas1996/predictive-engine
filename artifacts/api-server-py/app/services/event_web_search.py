"""Live web context for external-event injection via Ollama Cloud web search API."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MAX_CONTEXT_CHARS = 14_000

_DEFAULT_WEB_SEARCH_URL = "https://ollama.com/api/web_search"


def _clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _ollama_api_key() -> str:
    """Bearer token for https://ollama.com/api/web_search (create at ollama.com/settings/keys)."""
    return (
        os.getenv("OLLAMA_API_KEY", "")
        or os.getenv("OLLAMA_WEB_SEARCH_API_KEY", "")
        or ""
    ).strip()


def _format_ollama_results(results: list[Any]) -> str:
    lines: list[str] = []
    for i, item in enumerate(results, 1):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "").strip()
        content = _clip(str(item.get("content") or ""), 2000)
        chunk = f"[{i}] {title}"
        if url:
            chunk += f"\n{url}"
        if content:
            chunk += f"\n{content}"
        lines.append(chunk)
    return "\n\n".join(lines).strip()


async def gather_web_context(query: str) -> tuple[str, str]:
    """Call Ollama Cloud web search; return (context_blob, provider_label)."""
    q = query.strip()
    if len(q) < 2:
        return "", "none"

    key = _ollama_api_key()
    if not key:
        logger.warning("OLLAMA_API_KEY missing — web search disabled for events")
        return "", "none"

    url = (os.getenv("OLLAMA_WEB_SEARCH_URL") or _DEFAULT_WEB_SEARCH_URL).strip()

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            r = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={"query": q},
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = (exc.response.text or "")[:300]
        except Exception:
            pass
        logger.warning(
            "Ollama web_search HTTP %s for query=%r %s",
            exc.response.status_code,
            q[:80],
            detail,
        )
        return "", "none"
    except Exception:
        logger.exception("Ollama web_search failed for query=%r", q[:80])
        return "", "none"

    if not isinstance(data, dict):
        logger.warning("Ollama web_search returned non-object JSON")
        return "", "none"

    err = data.get("error")
    if isinstance(err, str) and err.strip():
        logger.warning("Ollama web_search error field: %s", err.strip()[:200])
        return "", "none"

    results = data.get("results")
    if not isinstance(results, list):
        logger.warning("Ollama web_search missing results array")
        return "", "none"

    text = _format_ollama_results(results)
    if len(text) < 40:
        return "", "none"

    return text[:_MAX_CONTEXT_CHARS], "ollama_web_search"
