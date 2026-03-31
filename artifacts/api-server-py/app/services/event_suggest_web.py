"""Use live web snippets + PwC GenAI to draft simulation external events."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services import event_web_search, llm_service

logger = logging.getLogger(__name__)


def _clamp(x: Any, lo: float, hi: float, default: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _normalize_payload(raw: dict[str, Any]) -> dict[str, Any]:
    t = str(raw.get("type") or "external_event").strip().lower()
    t = re.sub(r"[^a-z0-9_]+", "_", t).strip("_")[:120] or "external_event"
    desc = str(raw.get("description") or "").strip()
    if len(desc) < 20:
        raise ValueError("LLM returned too short a description")
    desc = desc[:4000]
    impact = _clamp(raw.get("impactScore"), -1.0, 1.0, 0.0)
    sources_note = str(raw.get("sourcesNote") or "").strip()[:500] or None
    return {
        "type": t,
        "description": desc,
        "impactScore": impact,
        "sourcesNote": sources_note,
    }


async def suggest_event_from_web(*, query: str) -> dict[str, Any]:
    if not llm_service.is_llm_available():
        raise RuntimeError(
            "PwC GenAI is not available. Configure PWC_GENAI_API_KEY / PWC_GENAI_BEARER_TOKEN "
            "and ensure the service can reach your tenant endpoint."
        )

    ctx, provider = await event_web_search.gather_web_context(query)
    if len(ctx.strip()) < 60:
        raise RuntimeError(
            "Could not retrieve enough live web context. Set OLLAMA_API_KEY (Ollama Cloud API key "
            "from https://ollama.com/settings/keys ) so the server can call "
            "https://ollama.com/api/web_search . Optional: OLLAMA_WEB_SEARCH_URL to override the endpoint."
        )

    prompt = f"""You help policy and social-simulation analysts draft EXTERNAL SHOCK events.

The user typed this topic / search phrase:
"{query.strip()}"

Below is text gathered from Ollama Cloud web search (provider: {provider}). Treat it as the best available
public snapshot — it may be incomplete, biased, or time-stamped implicitly in the snippets. Prefer the
most recent-looking facts when dates appear. Do not invent specific dates or quotes that are not
supported by the context; if uncertain, say so in the description.

--- Web context ---
{ctx}
--- End web context ---

Return ONE JSON object only. No markdown fences, no commentary.

Required keys (exact names):
- "type": short snake_case label for the event (e.g. tariff_announcement, regulatory_shift)
- "description": 3-7 sentences for simulation designers. Ground claims in the web context; note that
  information comes from public web sources and may lag real time. Be concrete about the topic.
- "impactScore": number from -1 to 1 (population-level sentiment / uncertainty shock: negative =
  fear, backlash, or instability; positive = relief, clarity, or supportive mood)
- "sourcesNote": optional one sentence naming the kind of sources (e.g. "News articles and wire items from search results")

The JSON must be valid UTF-8. Use double quotes for all keys and string values."""

    raw_text = (
        await llm_service.call_pwc_genai_async(
            prompt,
            task_name="simulation_agent",
            max_tokens=900,
            temperature=0.35,
        )
    ).strip()

    m = re.search(r"\{[\s\S]*\}", raw_text)
    if not m:
        raise RuntimeError("Model did not return a JSON object for the event draft")
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Model returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Model JSON is not an object")

    out = _normalize_payload(parsed)
    out["webSearchProvider"] = provider
    return out
