from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal, TypedDict

import httpx

logger = logging.getLogger(__name__)


class LLMResponse(TypedDict, total=False):
    action: Literal["post", "comment", "ignore"]
    content: str
    sentiment: float
    target_post_id: int | None
    agreement: Literal["agree", "disagree", "neutral"]


_llm_available = False
_base_url = ""
_model = ""


async def init_llm() -> bool:
    global _llm_available, _base_url, _model

    _base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    _model = os.environ.get("OLLAMA_MODEL", "llama3.2")

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{_base_url}/api/tags")
            if r.is_success:
                _llm_available = True
                logger.info("Ollama LLM connected baseUrl=%s model=%s", _base_url, _model)
                return True
    except Exception:
        pass

    logger.info(
        "No Ollama at %s — using deterministic agent content. "
        "Start Ollama or set OLLAMA_BASE_URL.",
        _base_url,
    )
    _llm_available = False
    return False


def is_llm_available() -> bool:
    return _llm_available


def get_llm_public_details() -> dict[str, str | None]:
    """Non-secret hints for dashboards (set after init_llm)."""
    if not _llm_available:
        return {"llmBackend": None, "llmModel": None}
    return {"llmBackend": "ollama", "llmModel": _model or None}


def _ollama_timeout() -> httpx.Timeout:
    """Local models often need >30s on CPU; read timeout is configurable."""
    read_s = max(30.0, float(os.environ.get("OLLAMA_READ_TIMEOUT", "120")))
    return httpx.Timeout(connect=15.0, read=read_s, write=120.0, pool=10.0)


async def _ollama_generate(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=_ollama_timeout()) as client:
        r = await client.post(
            f"{_base_url}/api/generate",
            json={
                "model": _model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.8,
                    "top_p": 0.9,
                    "num_predict": 512,
                },
            },
        )
        r.raise_for_status()
        data = r.json()
        return str(data.get("response", ""))


async def generate_text(prompt: str) -> str:
    if not _llm_available:
        raise RuntimeError("No LLM service available")
    return await _ollama_generate(prompt)


async def generate_agent_action(prompt: str) -> LLMResponse | None:
    try:
        raw = await generate_text(prompt)
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            logger.warning("LLM response did not contain valid JSON")
            return None
        parsed: dict[str, Any] = json.loads(m.group(0))
        sentiment = parsed.get("sentiment", 0)
        if isinstance(sentiment, (int, float)):
            parsed["sentiment"] = max(-1.0, min(1.0, float(sentiment)))
        else:
            parsed["sentiment"] = 0.0
        action = parsed.get("action", "post")
        if action not in ("post", "comment", "ignore"):
            parsed["action"] = "post"
        return parsed  # type: ignore[return-value]
    except httpx.HTTPStatusError as exc:
        snippet = ""
        try:
            snippet = (exc.response.text or "")[:400].strip()
        except Exception:
            pass
        logger.warning(
            "Failed to generate agent action via LLM: HTTP %s %s — %s",
            exc.response.status_code,
            exc.response.reason_phrase,
            snippet or str(exc) or "(empty body)",
        )
        return None
    except Exception as exc:
        logger.warning(
            "Failed to generate agent action via LLM: %s: %s",
            type(exc).__name__,
            exc if str(exc) else repr(exc),
        )
        return None
