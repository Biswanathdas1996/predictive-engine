"""Centralized utility for PwC GenAI LLM calls.

Unified interface for GenAI across the app: text / multimodal completion, embeddings,
and audio transcription. Model selection can be driven by ``llm_config.yml`` (repo root
or ``LLM_CONFIG_PATH``) via ``task_name``, with manual overrides for model, temperature,
and max_tokens.

Usage::

    response = await call_pwc_genai_async(prompt, task_name="policy_brief")
    response = await call_pwc_genai_async(prompt, model="azure.gpt-5.2", temperature=0.2)
    response = await call_pwc_genai_async(prompt, task_name="repo_analysis", images=[image_bytes])
    vectors = await call_pwc_embedding_async(["hello"], task_name="kb_embedding")
    text = await call_pwc_transcribe_async(audio_bytes, task_name="audio_transcription")
    response = call_pwc_genai_sync(prompt, task_name="unit_test_generation")
    prompt = build_pwc_prompt(system_message="You are helpful", user_message="What is Python?")

Langfuse hooks are optional no-ops unless you add a real integration.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import re
import threading
import time
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Literal, Optional, TypedDict

import httpx

from app.services.llm_config_loader import get_task_config

logger = logging.getLogger(__name__)

# --- Optional Langfuse-style hooks (no-op if not extended) -----------------


def _start_generation(**kwargs: Any) -> Any:
    class _G:
        def end(self, **_kw: Any) -> None:
            pass

    return _G()


def _start_span(**kwargs: Any) -> Any:
    class _S:
        def end(self, **_kw: Any) -> None:
            pass

    return _S()


def _extract_usage(_result: Dict[str, Any]) -> Any:
    return None


def _langfuse_flush() -> None:
    pass


# ---------------------------------------------------------------------------


class LLMResponse(TypedDict, total=False):
    action: Literal["post", "comment", "ignore"]
    content: str
    sentiment: float
    target_post_id: int | None
    agreement: Literal["agree", "disagree", "neutral"]


class ModelType(str, Enum):
    TEXT = "text"
    MULTIMODAL = "multimodal"
    EMBEDDING = "embedding"
    AUDIO = "audio"


# Default text/chat model when env and task do not specify a valid id (PwC gateway requires a non-null model).
_CATALOG_TEXT_DEFAULT = "vertex_ai.gemini-2.5-flash-image"

_INVALID_MODEL_PLACEHOLDERS = frozenset(
    {"", "none", "null", "nil", "undefined"},
)


def _normalize_model_value(value: Optional[str]) -> Optional[str]:
    """Treat empty and common placeholder strings as unset (avoids sending model='None' to the API)."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in _INVALID_MODEL_PLACEHOLDERS:
        return None
    return s


_MODEL_TYPE_MAP: Dict[str, ModelType] = {
    "vertex_ai.gemini-2.5-flash-image": ModelType.MULTIMODAL,
    "vertex_ai.gemini-2.5-pro": ModelType.MULTIMODAL,
    "azure.gpt-5.2": ModelType.TEXT,
    "vertex_ai.anthropic.claude-sonnet-4-6": ModelType.TEXT,
    "azure.grok-4-fast-reasoning": ModelType.TEXT,
    "openai.whisper": ModelType.AUDIO,
    "vertex_ai.text-embedding-005": ModelType.EMBEDDING,
    "vertex_ai.gemini-embedding": ModelType.EMBEDDING,
}


def detect_model_type(model_name: str) -> ModelType:
    if model_name in _MODEL_TYPE_MAP:
        return _MODEL_TYPE_MAP[model_name]
    name_lower = model_name.lower()
    if "whisper" in name_lower or "transcri" in name_lower:
        return ModelType.AUDIO
    if "embed" in name_lower:
        return ModelType.EMBEDDING
    if "gemini" in name_lower and ("image" in name_lower or "vision" in name_lower):
        return ModelType.MULTIMODAL
    return ModelType.TEXT


class PWCLLMConfig:
    """Configuration for PwC GenAI API (reads env on each access)."""

    @property
    def api_key(self) -> str:
        return (os.getenv("PWC_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()

    @property
    def bearer_token(self) -> str:
        return (os.getenv("PWC_GENAI_BEARER_TOKEN") or "").strip()

    @property
    def endpoint_url(self) -> str:
        return (
            os.getenv("PWC_GENAI_ENDPOINT_URL")
            or os.getenv("GEMINI_API_ENDPOINT")
            or "https://genai-sharedservice-americas.pwc.com/completions"
        ).rstrip("/")

    @property
    def default_model(self) -> str:
        """Raw env model id (may be empty or a placeholder string)."""
        return (os.getenv("PWC_GENAI_MODEL") or "").strip()

    def effective_model_id(self, explicit: Optional[str] = None) -> str:
        """Model id always sent on completion requests; PwC shared-service rejects a missing/null model."""
        m = _normalize_model_value(explicit) or _normalize_model_value(self.default_model)
        return m or _CATALOG_TEXT_DEFAULT

    @property
    def default_timeout(self) -> int:
        return max(15, int(os.getenv("PWC_GENAI_READ_TIMEOUT", "60")))

    def validate(self) -> None:
        if not self.api_key and not self.bearer_token:
            raise ValueError(
                "PwC GenAI API key not configured. Set PWC_GENAI_API_KEY or GEMINI_API_KEY "
                "and/or PWC_GENAI_BEARER_TOKEN in your environment."
            )

    def get_endpoint(self, model_type: ModelType, has_images: bool = False) -> str:
        base = self.endpoint_url.rstrip("/")
        if model_type == ModelType.EMBEDDING:
            if base.endswith("/completions"):
                return base.rsplit("/completions", 1)[0] + "/embeddings"
            if not base.endswith("/embeddings"):
                return base + "/embeddings"
        elif model_type == ModelType.AUDIO:
            if base.endswith("/completions"):
                return base.rsplit("/completions", 1)[0] + "/transcriptions"
            if not base.endswith("/transcriptions"):
                return base + "/transcriptions"
        elif has_images and model_type == ModelType.MULTIMODAL:
            if base.endswith("/completions"):
                return base.rsplit("/completions", 1)[0] + "/chat/completions"
        return base


_config = PWCLLMConfig()

# Legacy startup flag (set by init_llm)
_llm_available = False


# ---------------------------------------------------------------------------
# Concurrency + retries
# ---------------------------------------------------------------------------

_LLM_MAX_CONCURRENCY = int(os.getenv("LLM_MAX_CONCURRENCY", "3"))
_LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "5"))
_LLM_RETRY_BASE_DELAY = float(os.getenv("LLM_RETRY_BASE_DELAY", "1.0"))
_LLM_RETRY_MAX_DELAY = float(os.getenv("LLM_RETRY_MAX_DELAY", "30.0"))

_async_semaphore: Optional[asyncio.Semaphore] = None
_sync_semaphore = threading.Semaphore(_LLM_MAX_CONCURRENCY)


def _get_async_semaphore() -> asyncio.Semaphore:
    global _async_semaphore
    if _async_semaphore is None:
        _async_semaphore = asyncio.Semaphore(_LLM_MAX_CONCURRENCY)
    return _async_semaphore


def get_llm_concurrency_stats() -> Dict[str, Any]:
    sem = _get_async_semaphore()
    available = sem._value if hasattr(sem, "_value") else "unknown"
    return {
        "max_concurrency": _LLM_MAX_CONCURRENCY,
        "available_slots": available,
        "max_retries": _LLM_MAX_RETRIES,
        "retry_base_delay": _LLM_RETRY_BASE_DELAY,
        "retry_max_delay": _LLM_RETRY_MAX_DELAY,
    }


def _is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    if "429" in msg or "rate limit" in msg or "rate_limit" in msg or "too many requests" in msg:
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response is not None and exc.response.status_code == 429
    return False


def _compute_backoff(attempt: int) -> float:
    delay = min(_LLM_RETRY_BASE_DELAY * (2**attempt), _LLM_RETRY_MAX_DELAY)
    jitter = random.uniform(0, delay * 0.3)
    return delay + jitter


# ---------------------------------------------------------------------------
# Shared async HTTP client
# ---------------------------------------------------------------------------

_shared_async_client: Optional[httpx.AsyncClient] = None
_shared_async_client_loop_id: Optional[int] = None


def _get_async_client() -> httpx.AsyncClient:
    global _shared_async_client, _shared_async_client_loop_id
    try:
        current_loop = asyncio.get_running_loop()
        current_loop_id = id(current_loop)
    except RuntimeError:
        current_loop_id = None

    need_new = (
        _shared_async_client is None
        or _shared_async_client.is_closed
        or (current_loop_id is not None and current_loop_id != _shared_async_client_loop_id)
    )
    if need_new:
        _shared_async_client = httpx.AsyncClient(
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
        _shared_async_client_loop_id = current_loop_id
    return _shared_async_client


def invalidate_async_client() -> None:
    global _shared_async_client, _shared_async_client_loop_id
    _shared_async_client = None
    _shared_async_client_loop_id = None


async def close_async_client() -> None:
    global _shared_async_client, _shared_async_client_loop_id
    if _shared_async_client is not None and not _shared_async_client.is_closed:
        await _shared_async_client.aclose()
    _shared_async_client = None
    _shared_async_client_loop_id = None


async def _bg_flush() -> None:
    try:
        _langfuse_flush()
    except Exception:
        pass


def _resolve_task_config(task_name: Optional[str] = None):
    if not task_name:
        return None
    return get_task_config(task_name)


def _force_chat_messages() -> bool:
    return os.environ.get("PWC_GENAI_USE_CHAT_MESSAGES", "").strip().lower() in ("1", "true", "yes")


def _use_messages_payload(endpoint: str, has_multimodal_messages: bool) -> bool:
    if has_multimodal_messages:
        return True
    if _force_chat_messages():
        return True
    return "chat/completions" in endpoint.lower()


def _auth_headers() -> Dict[str, str]:
    """Headers compatible with PwC GenAI and existing PWC_GENAI_AUTH_MODE."""
    api_key = _config.api_key
    bearer = _config.bearer_token
    headers: Dict[str, str] = {"Content-Type": "application/json", "accept": "application/json"}
    mode = (os.environ.get("PWC_GENAI_AUTH_MODE") or "auto").strip().lower()

    if mode == "bearer":
        tok = bearer or api_key
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        return headers
    if mode == "api_key":
        key = api_key or bearer
        if key:
            headers["API-Key"] = key
            headers["x-api-key"] = key
        return headers
    if mode == "both":
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if api_key:
            headers["API-Key"] = api_key
            headers["x-api-key"] = api_key
        return headers
    # auto
    if api_key and bearer and api_key == bearer:
        headers["Authorization"] = f"Bearer {bearer}"
        return headers
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if api_key:
        headers["API-Key"] = api_key
        headers["x-api-key"] = api_key
    return headers


def _build_headers() -> Dict[str, str]:
    return _auth_headers()


def _detect_mime_type(img_bytes: bytes) -> str:
    if img_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if img_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if img_bytes[:4] == b"GIF8":
        return "image/gif"
    if len(img_bytes) >= 12 and img_bytes[:4] == b"RIFF" and img_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _default_top_p() -> float:
    try:
        return float(os.environ.get("PWC_GENAI_TOP_P", "1"))
    except ValueError:
        return 1.0


def _default_seed() -> int:
    try:
        return int(os.environ.get("PWC_GENAI_SEED", "25"))
    except ValueError:
        return 25


def _build_request_body(
    prompt: str,
    temperature: float = 0.2,
    max_tokens: int = 6096,
    model: Optional[str] = None,
    images: Optional[List[bytes]] = None,
    endpoint: str = "",
) -> Dict[str, Any]:
    req_model = _config.effective_model_id(model)
    model_type = detect_model_type(req_model)
    is_anthropic = "anthropic" in req_model.lower()
    use_messages = _use_messages_payload(endpoint, bool(images and model_type == ModelType.MULTIMODAL))

    if images and model_type == ModelType.MULTIMODAL:
        content_parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img_bytes in images:
            mime = _detect_mime_type(img_bytes)
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            content_parts.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            )
        body: Dict[str, Any] = {
            "model": req_model,
            "messages": [{"role": "user", "content": content_parts}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
    elif use_messages:
        body = {
            "model": req_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
    else:
        body = {
            "model": req_model,
            "prompt": prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            "stream_options": None,
            "stop": None,
        }

    if not is_anthropic:
        body["top_p"] = _default_top_p()
        body["presence_penalty"] = 0
        body["seed"] = _default_seed()

    return body


def _build_embedding_request_body(texts: List[str], model: str) -> Dict[str, Any]:
    return {"model": model, "input": texts}


def _build_transcription_request_body(
    audio_data: bytes,
    model: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": model,
        "audio": base64.b64encode(audio_data).decode("utf-8"),
    }
    if language:
        body["language"] = language
    return body


def _extract_text_from_response(result: Dict[str, Any]) -> str:
    if "choices" in result and len(result["choices"]) > 0:
        choice = result["choices"][0]
        if "message" in choice and "content" in choice["message"]:
            return str(choice["message"]["content"])
        if "text" in choice:
            return str(choice["text"])
    if "text" in result:
        return str(result["text"])
    if "content" in result:
        return str(result["content"])
    if "response" in result:
        return str(result["response"])
    raise ValueError("Unexpected response format from PwC GenAI API")


def _extract_embeddings_from_response(result: Dict[str, Any]) -> List[List[float]]:
    if "data" in result:
        return [item["embedding"] for item in sorted(result["data"], key=lambda x: x.get("index", 0))]
    if "embedding" in result:
        emb = result["embedding"]
        return [emb] if isinstance(emb[0], float) else emb
    if "embeddings" in result:
        return result["embeddings"]
    raise ValueError("Unexpected embedding response format from PwC GenAI API")


def _extract_transcription_from_response(result: Dict[str, Any]) -> str:
    if "text" in result:
        return str(result["text"])
    if "transcription" in result:
        return str(result["transcription"])
    if "results" in result and len(result["results"]) > 0:
        return " ".join(r.get("text", "") for r in result["results"])
    raise ValueError("Unexpected transcription response format from PwC GenAI API")


def _get_finish_reason(result: Dict[str, Any]) -> Optional[str]:
    if "choices" in result and len(result["choices"]) > 0:
        return result["choices"][0].get("finish_reason", "stop")
    return "stop"


def _http_timeout() -> httpx.Timeout:
    read_s = float(_config.default_timeout)
    return httpx.Timeout(connect=10.0, read=read_s, write=30.0, pool=10.0)


def _http_error_detail(exc: httpx.HTTPStatusError) -> str:
    try:
        body = (exc.response.text or "").strip()
    except Exception:
        body = ""
    if len(body) > 500:
        body = body[:500] + "…"
    base = f"HTTP {exc.response.status_code} from GenAI"
    return f"{base}: {body}" if body else base


def _default_max_tokens() -> int:
    return max(32, min(512, int(os.environ.get("PWC_GENAI_MAX_TOKENS", "128"))))


# ============================================================================
# Text / Multimodal completion
# ============================================================================


async def call_pwc_genai_async(
    prompt: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
    enable_continuation: bool = False,
    max_continuations: int = 3,
    task_name: Optional[str] = None,
    images: Optional[List[bytes]] = None,
) -> str:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        temperature = temperature if temperature is not None else task_cfg.temperature
        max_tokens = max_tokens if max_tokens is not None else task_cfg.max_tokens
        timeout = timeout if timeout is not None else task_cfg.timeout

    temperature = temperature if temperature is not None else 0.2
    max_tokens = max_tokens if max_tokens is not None else 6096
    api_model = _config.effective_model_id(model)
    model_type = detect_model_type(api_model)

    if images and model_type != ModelType.MULTIMODAL:
        logger.debug(
            "images provided but model %s is not multimodal — ignoring images",
            api_model,
        )
        images = None

    logger.debug(
        "genai_async task=%s model=%s type=%s temp=%s max_tokens=%s%s",
        task_name or "adhoc",
        api_model,
        model_type.value,
        temperature,
        max_tokens,
        f" images={len(images)}" if images else "",
    )

    sem = _get_async_semaphore()
    if sem.locked():
        logger.info(
            "genai_async task=%s queued (max concurrency %s)",
            task_name or "adhoc",
            _LLM_MAX_CONCURRENCY,
        )

    async with sem:
        return await _call_pwc_genai_async_inner(
            prompt,
            temperature,
            max_tokens,
            model,
            api_model,
            model_type,
            timeout,
            enable_continuation,
            max_continuations,
            task_name,
            images,
        )


async def _call_pwc_genai_async_inner(
    prompt: str,
    temperature: float,
    max_tokens: int,
    model: Optional[str],
    model_label: str,
    model_type: ModelType,
    timeout: Optional[int],
    enable_continuation: bool,
    max_continuations: int,
    task_name: Optional[str],
    images: Optional[List[bytes]],
) -> str:
    generation = _start_generation(
        task_name=task_name or "adhoc",
        model=model_label,
        prompt=prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        metadata={
            "continuation": enable_continuation,
            "model_type": model_type.value,
            "has_images": bool(images),
        },
    )

    endpoint = _config.get_endpoint(model_type, has_images=bool(images))
    request_body = _build_request_body(
        prompt, temperature, max_tokens, model, images=images, endpoint=endpoint
    )
    headers = _build_headers()
    timeout_value = timeout or _config.default_timeout
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)

    accumulated_text = ""
    original_prompt = prompt
    usage = None
    result: Dict[str, Any] | None = None
    attempts = max_continuations + 1 if enable_continuation else 1

    try:
        for attempt in range(attempts):
            if attempt > 0:
                continuation_prompt = (
                    f"{original_prompt}\n\n"
                    "[CONTINUATION] The previous response was cut off. Here is what was generated so far:\n"
                    f"---\n{accumulated_text[-2000:]}\n---\n"
                    "Please continue from where you left off. Do not repeat what was already generated."
                )
                if "prompt" in request_body:
                    request_body["prompt"] = continuation_prompt
                elif "messages" in request_body and request_body["messages"]:
                    request_body["messages"] = [{"role": "user", "content": continuation_prompt}]

            success = False
            for retry in range(_LLM_MAX_RETRIES):
                try:
                    client = _get_async_client()
                    response = await client.post(
                        endpoint,
                        json=request_body,
                        headers=headers,
                        timeout=timeout_cfg,
                    )

                    if response.status_code == 429:
                        backoff = _compute_backoff(retry)
                        logger.warning(
                            "Rate limited (429) task=%s retry %s/%s backoff=%.1fs",
                            task_name or "adhoc",
                            retry + 1,
                            _LLM_MAX_RETRIES,
                            backoff,
                        )
                        await asyncio.sleep(backoff)
                        continue

                    if response.status_code != 200:
                        raise ValueError(f"PwC GenAI API Error: {response.status_code} - {response.text}")

                    result = response.json()
                    chunk = _extract_text_from_response(result)
                    accumulated_text += chunk
                    usage = _extract_usage(result)
                    success = True
                    break
                except Exception as e:
                    if _is_rate_limit_error(e) and retry < _LLM_MAX_RETRIES - 1:
                        backoff = _compute_backoff(retry)
                        logger.warning(
                            "Rate limit error task=%s retry %s/%s: %s",
                            task_name or "adhoc",
                            retry + 1,
                            _LLM_MAX_RETRIES,
                            e,
                        )
                        await asyncio.sleep(backoff)
                        continue
                    raise

            if not success:
                raise ValueError(
                    f"Rate limit exceeded after {_LLM_MAX_RETRIES} retries for task={task_name or 'adhoc'}"
                )

            if enable_continuation and result is not None:
                finish_reason = _get_finish_reason(result)
                if finish_reason != "length":
                    break
            else:
                break

        end_kwargs: Dict[str, Any] = {"output": accumulated_text[:8000]}
        if usage:
            end_kwargs["usage"] = usage
        generation.end(**end_kwargs)
        asyncio.create_task(_bg_flush())
    except Exception as exc:
        generation.end(output=f"ERROR: {exc}", level="ERROR", status_message=str(exc))
        asyncio.create_task(_bg_flush())
        raise

    return accumulated_text


async def call_pwc_genai_stream(
    prompt: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
    task_name: Optional[str] = None,
) -> AsyncIterator[str]:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        temperature = temperature if temperature is not None else task_cfg.temperature
        max_tokens = max_tokens if max_tokens is not None else task_cfg.max_tokens
        timeout = timeout if timeout is not None else task_cfg.timeout

    temperature = temperature if temperature is not None else 0.2
    max_tokens = max_tokens if max_tokens is not None else 6096
    api_model = _config.effective_model_id(model)
    model_type = detect_model_type(api_model)
    endpoint = _config.get_endpoint(model_type)
    request_body = _build_request_body(
        prompt, temperature, max_tokens, model, images=None, endpoint=endpoint
    )
    request_body["stream"] = True
    headers = _build_headers()
    timeout_value = timeout or _config.default_timeout
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)

    sem = _get_async_semaphore()
    async with sem:
        generation = _start_generation(
            task_name=task_name or "adhoc_stream",
            model=api_model,
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            metadata={"streaming": True, "model_type": model_type.value},
        )
        accumulated_text = ""
        try:
            client = _get_async_client()
            _stream_ctx = None
            response = None
            for stream_retry in range(_LLM_MAX_RETRIES):
                try:
                    _stream_ctx = client.stream(
                        "POST",
                        endpoint,
                        json=request_body,
                        headers=headers,
                        timeout=timeout_cfg,
                    )
                    response = await _stream_ctx.__aenter__()
                    if response.status_code == 429:
                        await _stream_ctx.__aexit__(None, None, None)
                        _stream_ctx = None
                        bk = _compute_backoff(stream_retry)
                        logger.warning(
                            "stream 429 task=%s retry %s/%s backoff=%.1fs",
                            task_name or "adhoc",
                            stream_retry + 1,
                            _LLM_MAX_RETRIES,
                            bk,
                        )
                        await asyncio.sleep(bk)
                        continue
                    break
                except Exception as conn_exc:
                    if _stream_ctx is not None:
                        try:
                            await _stream_ctx.__aexit__(None, None, None)
                        except Exception:
                            pass
                        _stream_ctx = None
                    if _is_rate_limit_error(conn_exc) and stream_retry < _LLM_MAX_RETRIES - 1:
                        bk = _compute_backoff(stream_retry)
                        logger.warning("stream rate limit: %s", conn_exc)
                        await asyncio.sleep(bk)
                        continue
                    raise
            else:
                raise ValueError(
                    f"Rate limit exceeded after {_LLM_MAX_RETRIES} retries for streaming "
                    f"task={task_name or 'adhoc'}"
                )

            assert _stream_ctx is not None and response is not None
            try:
                if response.status_code != 200:
                    body = await response.aread()
                    raise ValueError(f"PwC GenAI API Error: {response.status_code} - {body.decode()}")

                content_type = response.headers.get("content-type", "")
                is_sse = "text/event-stream" in content_type
                got_chunks = False
                logger.info("stream content-type=%s is_sse=%s", content_type, is_sse)

                buffer = ""
                async for raw_chunk in response.aiter_text():
                    buffer += raw_chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith("data: "):
                            line = line[6:]
                        if line == "[DONE]":
                            break
                        try:
                            chunk_data = json.loads(line)
                            delta_text = ""
                            if "choices" in chunk_data and len(chunk_data["choices"]) > 0:
                                choice = chunk_data["choices"][0]
                                delta = choice.get("delta", {})
                                delta_text = delta.get("content", "") or choice.get("text", "") or ""
                                if not delta_text:
                                    msg = choice.get("message", {})
                                    delta_text = msg.get("content", "") or ""
                            elif "text" in chunk_data:
                                delta_text = str(chunk_data["text"])
                            elif "content" in chunk_data:
                                delta_text = str(chunk_data["content"])
                            if delta_text:
                                got_chunks = True
                                accumulated_text += delta_text
                                yield delta_text
                        except json.JSONDecodeError:
                            continue

                if buffer.strip():
                    try:
                        chunk_data = json.loads(buffer.strip())
                        text = _extract_text_from_response(chunk_data)
                        if text and not got_chunks:
                            accumulated_text += text
                            yield text
                    except (json.JSONDecodeError, ValueError):
                        pass
            finally:
                await _stream_ctx.__aexit__(None, None, None)

            generation.end(output=accumulated_text[:8000])
            asyncio.create_task(_bg_flush())
        except Exception as exc:
            generation.end(output=f"ERROR: {exc}", level="ERROR", status_message=str(exc))
            asyncio.create_task(_bg_flush())
            raise


def call_pwc_genai_sync(
    prompt: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    model: Optional[str] = None,
    timeout: Optional[int] = None,
    enable_continuation: bool = True,
    max_continuations: int = 3,
    task_name: Optional[str] = None,
    images: Optional[List[bytes]] = None,
) -> str:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        temperature = temperature if temperature is not None else task_cfg.temperature
        max_tokens = max_tokens if max_tokens is not None else task_cfg.max_tokens
        timeout = timeout if timeout is not None else task_cfg.timeout

    temperature = temperature if temperature is not None else 0.2
    max_tokens = max_tokens if max_tokens is not None else 6096
    api_model = _config.effective_model_id(model)
    model_type = detect_model_type(api_model)

    if images and model_type != ModelType.MULTIMODAL:
        images = None

    logger.info("genai_sync acquiring slot (max %s)", _LLM_MAX_CONCURRENCY)
    _sync_semaphore.acquire()
    try:
        return _call_pwc_genai_sync_inner(
            prompt,
            temperature,
            max_tokens,
            model,
            api_model,
            model_type,
            timeout,
            enable_continuation,
            max_continuations,
            task_name,
            images,
        )
    finally:
        _sync_semaphore.release()


def _call_pwc_genai_sync_inner(
    prompt: str,
    temperature: float,
    max_tokens: int,
    model: Optional[str],
    model_label: str,
    model_type: ModelType,
    timeout: Optional[int],
    enable_continuation: bool,
    max_continuations: int,
    task_name: Optional[str],
    images: Optional[List[bytes]],
) -> str:
    generation = _start_generation(
        task_name=task_name or "adhoc",
        model=model_label,
        prompt=prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        metadata={
            "continuation": enable_continuation,
            "model_type": model_type.value,
            "has_images": bool(images),
        },
    )
    endpoint = _config.get_endpoint(model_type, has_images=bool(images))
    request_body = _build_request_body(
        prompt, temperature, max_tokens, model, images=images, endpoint=endpoint
    )
    headers = _build_headers()
    timeout_value = timeout or _config.default_timeout
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)

    accumulated_text = ""
    original_prompt = prompt
    usage = None
    result: Dict[str, Any] | None = None
    attempts = max_continuations + 1 if enable_continuation else 1

    try:
        for attempt in range(attempts):
            if attempt > 0:
                continuation_prompt = (
                    f"{original_prompt}\n\n"
                    "[CONTINUATION] The previous response was cut off. Here is what was generated so far:\n"
                    f"---\n{accumulated_text[-2000:]}\n---\n"
                    "Please continue from where you left off. Do not repeat what was already generated."
                )
                if "prompt" in request_body:
                    request_body["prompt"] = continuation_prompt
                elif "messages" in request_body and request_body["messages"]:
                    request_body["messages"] = [{"role": "user", "content": continuation_prompt}]

            success = False
            for retry in range(_LLM_MAX_RETRIES):
                try:
                    with httpx.Client(timeout=timeout_cfg) as client:
                        response = client.post(endpoint, json=request_body, headers=headers)

                    if response.status_code == 429:
                        backoff = _compute_backoff(retry)
                        logger.warning(
                            "sync 429 task=%s retry %s/%s backoff=%.1fs",
                            task_name or "adhoc",
                            retry + 1,
                            _LLM_MAX_RETRIES,
                            backoff,
                        )
                        time.sleep(backoff)
                        continue

                    if response.status_code != 200:
                        raise ValueError(f"PwC GenAI API Error: {response.status_code} - {response.text}")

                    result = response.json()
                    chunk = _extract_text_from_response(result)
                    accumulated_text += chunk
                    usage = _extract_usage(result)
                    success = True
                    break
                except Exception as e:
                    if _is_rate_limit_error(e) and retry < _LLM_MAX_RETRIES - 1:
                        backoff = _compute_backoff(retry)
                        time.sleep(backoff)
                        continue
                    raise

            if not success:
                raise ValueError(
                    f"Rate limit exceeded after {_LLM_MAX_RETRIES} retries for task={task_name or 'adhoc'}"
                )

            if enable_continuation and result is not None:
                if _get_finish_reason(result) != "length":
                    break
            else:
                break

        end_kwargs: Dict[str, Any] = {"output": accumulated_text[:8000]}
        if usage:
            end_kwargs["usage"] = usage
        generation.end(**end_kwargs)
    except Exception as exc:
        generation.end(output=f"ERROR: {exc}", level="ERROR", status_message=str(exc))
        raise

    return accumulated_text


# ============================================================================
# Embedding
# ============================================================================


async def call_pwc_embedding_async(
    texts: List[str],
    model: Optional[str] = None,
    task_name: Optional[str] = None,
    timeout: Optional[int] = None,
) -> List[List[float]]:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        timeout = timeout if timeout is not None else task_cfg.timeout

    resolved_model = _normalize_model_value(model) or "vertex_ai.text-embedding-005"
    timeout_value = timeout or _config.default_timeout
    endpoint = _config.get_endpoint(ModelType.EMBEDDING)
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)

    sem = _get_async_semaphore()
    async with sem:
        request_body = _build_embedding_request_body(texts, resolved_model)
        headers = _build_headers()
        span = _start_span(
            name=f"embedding/{task_name or 'adhoc'}",
            input=f"texts={len(texts)}, model={resolved_model}",
            metadata={"model": resolved_model, "text_count": len(texts)},
        )
        try:
            client = _get_async_client()
            for emb_retry in range(_LLM_MAX_RETRIES):
                try:
                    response = await client.post(
                        endpoint, json=request_body, headers=headers, timeout=timeout_cfg
                    )
                    if response.status_code == 429:
                        bk = _compute_backoff(emb_retry)
                        await asyncio.sleep(bk)
                        continue
                    if response.status_code != 200:
                        raise ValueError(
                            f"PwC GenAI Embedding API Error: {response.status_code} - {response.text}"
                        )
                    result = response.json()
                    embeddings = _extract_embeddings_from_response(result)
                    span.end(
                        output=f"Generated {len(embeddings)} embeddings, "
                        f"dims={len(embeddings[0]) if embeddings else 0}"
                    )
                    asyncio.create_task(_bg_flush())
                    return embeddings
                except Exception as emb_exc:
                    if _is_rate_limit_error(emb_exc) and emb_retry < _LLM_MAX_RETRIES - 1:
                        await asyncio.sleep(_compute_backoff(emb_retry))
                        continue
                    raise
            raise ValueError(
                f"Rate limit exceeded after {_LLM_MAX_RETRIES} retries for embedding "
                f"task={task_name or 'adhoc'}"
            )
        except Exception as exc:
            span.end(output=f"ERROR: {exc}")
            asyncio.create_task(_bg_flush())
            raise


def call_pwc_embedding_sync(
    texts: List[str],
    model: Optional[str] = None,
    task_name: Optional[str] = None,
    timeout: Optional[int] = None,
) -> List[List[float]]:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        timeout = timeout if timeout is not None else task_cfg.timeout

    resolved_model = _normalize_model_value(model) or "vertex_ai.text-embedding-005"
    timeout_value = timeout or _config.default_timeout
    endpoint = _config.get_endpoint(ModelType.EMBEDDING)
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)
    request_body = _build_embedding_request_body(texts, resolved_model)
    headers = _build_headers()
    span = _start_span(
        name=f"embedding-sync/{task_name or 'adhoc'}",
        input=f"texts={len(texts)}, model={resolved_model}",
        metadata={"model": resolved_model, "text_count": len(texts)},
    )
    try:
        with httpx.Client(timeout=timeout_cfg) as client:
            response = client.post(endpoint, json=request_body, headers=headers)
        if response.status_code != 200:
            raise ValueError(f"PwC GenAI Embedding API Error: {response.status_code} - {response.text}")
        result = response.json()
        embeddings = _extract_embeddings_from_response(result)
        span.end(
            output=f"Generated {len(embeddings)} embeddings, dims={len(embeddings[0]) if embeddings else 0}"
        )
        return embeddings
    except Exception as exc:
        span.end(output=f"ERROR: {exc}")
        raise


# ============================================================================
# Audio transcription
# ============================================================================


async def call_pwc_transcribe_async(
    audio_data: bytes,
    model: Optional[str] = None,
    task_name: Optional[str] = None,
    language: Optional[str] = None,
    timeout: Optional[int] = None,
) -> str:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        timeout = timeout if timeout is not None else task_cfg.timeout

    resolved_model = _normalize_model_value(model) or "openai.whisper"
    timeout_value = timeout or _config.default_timeout
    endpoint = _config.get_endpoint(ModelType.AUDIO)
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)
    request_body = _build_transcription_request_body(audio_data, resolved_model, language)
    headers = _build_headers()
    span = _start_span(
        name=f"transcribe/{task_name or 'adhoc'}",
        input=f"model={resolved_model}, bytes={len(audio_data)}",
        metadata={"model": resolved_model, "audio_size_bytes": len(audio_data), "language": language},
    )
    try:
        client = _get_async_client()
        response = await client.post(endpoint, json=request_body, headers=headers, timeout=timeout_cfg)
        if response.status_code != 200:
            raise ValueError(f"PwC GenAI Transcription API Error: {response.status_code} - {response.text}")
        result = response.json()
        text = _extract_transcription_from_response(result)
        span.end(output=text[:8000])
        asyncio.create_task(_bg_flush())
        return text
    except Exception as exc:
        span.end(output=f"ERROR: {exc}")
        asyncio.create_task(_bg_flush())
        raise


def call_pwc_transcribe_sync(
    audio_data: bytes,
    model: Optional[str] = None,
    task_name: Optional[str] = None,
    language: Optional[str] = None,
    timeout: Optional[int] = None,
) -> str:
    _config.validate()
    task_cfg = _resolve_task_config(task_name)
    if task_cfg:
        model = model or task_cfg.model
        timeout = timeout if timeout is not None else task_cfg.timeout

    resolved_model = _normalize_model_value(model) or "openai.whisper"
    timeout_value = timeout or _config.default_timeout
    endpoint = _config.get_endpoint(ModelType.AUDIO)
    timeout_cfg = httpx.Timeout(connect=10.0, read=float(timeout_value), write=30.0, pool=10.0)
    request_body = _build_transcription_request_body(audio_data, resolved_model, language)
    headers = _build_headers()
    span = _start_span(
        name=f"transcribe-sync/{task_name or 'adhoc'}",
        input=f"model={resolved_model}, bytes={len(audio_data)}",
        metadata={"model": resolved_model, "audio_size_bytes": len(audio_data), "language": language},
    )
    try:
        with httpx.Client(timeout=timeout_cfg) as client:
            response = client.post(endpoint, json=request_body, headers=headers)
        if response.status_code != 200:
            raise ValueError(f"PwC GenAI Transcription API Error: {response.status_code} - {response.text}")
        result = response.json()
        text = _extract_transcription_from_response(result)
        span.end(output=text[:8000])
        return text
    except Exception as exc:
        span.end(output=f"ERROR: {exc}")
        raise


# ============================================================================
# Helpers + app integration
# ============================================================================


def build_pwc_prompt(system_message: str, user_message: str) -> str:
    return f"System: {system_message}\n\nUser: {user_message}"


def get_pwc_config() -> PWCLLMConfig:
    return _config


async def init_llm() -> bool:
    """Load env (via app.config), probe GenAI if possible, set ``_llm_available``."""
    global _llm_available

    import app.config  # noqa: F401 — loads repo .env

    _llm_available = False
    if not _config.api_key and not _config.bearer_token:
        logger.info(
            "No PwC GenAI credentials — using deterministic agent content. "
            "Set PWC_GENAI_API_KEY or PWC_GENAI_BEARER_TOKEN."
        )
        return False

    strict_probe = os.environ.get("PWC_GENAI_STRICT_PROBE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    skip_probe = os.environ.get("PWC_GENAI_SKIP_PROBE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if skip_probe:
        _llm_available = True
        logger.warning(
            "PWC_GENAI_SKIP_PROBE is set — skipping connectivity probe; "
            "simulation rounds will fail at runtime if GenAI is unreachable."
        )
        return True

    endpoint = _config.get_endpoint(ModelType.TEXT, has_images=False)
    headers = _build_headers()
    body = _build_request_body("ping", 0.2, 1, None, None, endpoint=endpoint)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(endpoint, headers=headers, json=body)
            if r.is_success or r.status_code in (200, 400, 422):
                _llm_available = True
                logger.info(
                    "PwC GenAI connected endpoint=%s model=%s",
                    endpoint,
                    _config.effective_model_id(None),
                )
                return True
            logger.warning(
                "PwC GenAI probe HTTP %s at %s — check URL, model, and auth.",
                r.status_code,
                endpoint,
            )
    except Exception as exc:
        logger.warning("PwC GenAI probe error (%s): %s", type(exc).__name__, exc)

    if not strict_probe:
        _llm_available = True
        logger.warning(
            "PwC GenAI startup probe did not succeed, but credentials are set — "
            "enabling GenAI for simulation rounds anyway. "
            "Set PWC_GENAI_STRICT_PROBE=1 to require a successful probe."
        )
        return True

    logger.info("Cannot reach PwC GenAI at %s — using deterministic agent content.", endpoint)
    _llm_available = False
    return False


def is_llm_available() -> bool:
    return _llm_available


def get_llm_public_details() -> dict[str, str | None]:
    if not _llm_available:
        return {"llmBackend": None, "llmModel": None}
    return {"llmBackend": "pwc_genai", "llmModel": _config.effective_model_id(None)}


async def generate_text(prompt: str) -> str:
    if not _llm_available:
        raise RuntimeError("No LLM service available")
    temp = float(os.environ.get("PWC_GENAI_TEMPERATURE", "0.4"))
    return await call_pwc_genai_async(
        prompt,
        task_name="simulation_agent",
        max_tokens=_default_max_tokens(),
        temperature=temp,
    )


async def policy_key_points_brief(title: str, summary: str) -> str:
    if not _llm_available:
        raise RuntimeError("No LLM service available")

    out_max = max(200, min(2000, int(os.environ.get("PWC_GENAI_POLICY_BRIEF_CHARS", "900"))))
    input_max = max(500, min(32000, int(os.environ.get("PWC_GENAI_POLICY_BRIEF_INPUT_MAX", "4000"))))
    brief_tok = max(64, min(512, int(os.environ.get("PWC_GENAI_POLICY_BRIEF_MAX_TOKENS", "256"))))

    t = (title or "").strip()
    s = (summary or "").strip()
    if not t and not s:
        raise RuntimeError("Policy has no title or summary for the LLM to distill")

    body = f"Title: {t}\n\nSummary:\n{s}" if s else f"Title: {t}"
    body = body.strip()[:input_max]

    prompt = (
        "You distill policy information into key points for a social simulation. "
        "Output 4-7 bullet lines only. Each line starts with '- ' then text (max 90 chars per line). "
        "Stay faithful to the input. No preamble, no title line, no JSON, no markdown besides leading dashes.\n\n"
        f"Policy material to distill:\n{body}"
    )
    try:
        raw = (
            await call_pwc_genai_async(
                prompt,
                task_name="policy_brief",
                max_tokens=brief_tok,
            )
        ).strip()
    except httpx.HTTPStatusError as exc:
        hint = (
            " Confirm PWC_GENAI_MODEL if your tenant requires it; try PWC_GENAI_AUTH_MODE=bearer "
            "or api_key if you currently send duplicate credentials."
        )
        if exc.response.status_code >= 500:
            hint += " A 5xx is usually a gateway or upstream model error (retry later or contact PwC GenAI support)."
        raise RuntimeError(_http_error_detail(exc) + hint) from exc
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc
    if len(raw) < 12:
        raise RuntimeError("Policy summarization returned empty output")
    return raw[:out_max]


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


__all__ = [
    "LLMResponse",
    "ModelType",
    "PWCLLMConfig",
    "build_pwc_prompt",
    "call_pwc_embedding_async",
    "call_pwc_embedding_sync",
    "call_pwc_genai_async",
    "call_pwc_genai_stream",
    "call_pwc_genai_sync",
    "call_pwc_transcribe_async",
    "call_pwc_transcribe_sync",
    "close_async_client",
    "detect_model_type",
    "generate_agent_action",
    "generate_text",
    "get_llm_concurrency_stats",
    "get_llm_public_details",
    "get_pwc_config",
    "init_llm",
    "invalidate_async_client",
    "is_llm_available",
    "policy_key_points_brief",
]
