"""LLM-assisted simulation reports from post/comment transcripts (PwC GenAI)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import asyncpg

from app.services.llm_service import call_pwc_genai_async, is_llm_available

logger = logging.getLogger(__name__)

MAX_TRANSCRIPT_CHARS = 14_000


def _truncate_transcript(text: str, limit: int = MAX_TRANSCRIPT_CHARS) -> str:
    t = text.strip()
    if len(t) <= limit:
        return t
    head = 1200
    return (
        t[:head]
        + "\n\n...[middle of feed omitted for length]...\n\n"
        + t[-(limit - head - 80) :]
    )


def build_conversation_transcript(
    *,
    posts: list[asyncpg.Record],
    comments: list[asyncpg.Record],
    agent_names: dict[int, str],
) -> str:
    """Linear transcript: posts in round order with replies nested by line prefix."""
    if not posts:
        return ""

    posts_sorted = sorted(
        posts,
        key=lambda p: (int(p["round"] or 0), str(p.get("created_at") or "")),
    )
    by_post: dict[int, list[asyncpg.Record]] = {}
    for c in comments:
        pid = int(c["post_id"])
        by_post.setdefault(pid, []).append(c)
    for lst in by_post.values():
        lst.sort(
            key=lambda c: (int(c["round"] or 0), str(c.get("created_at") or "")),
        )

    lines: list[str] = []
    for pr in posts_sorted:
        pid = int(pr["id"])
        aid = int(pr["agent_id"])
        name = agent_names.get(aid, f"Agent {aid}")
        r = int(pr["round"] or 0)
        body = str(pr.get("content") or "").strip().replace("\r\n", "\n")
        if len(body) > 1200:
            body = body[:1197] + "..."
        lines.append(f"[Round {r}] {name} (post): {body}")

        for c in by_post.get(pid, []):
            cid = int(c["agent_id"])
            cname = agent_names.get(cid, f"Agent {cid}")
            cr = int(c["round"] or 0)
            cbody = str(c.get("content") or "").strip().replace("\r\n", "\n")
            if len(cbody) > 800:
                cbody = cbody[:797] + "..."
            lines.append(f"    └─ [Round {cr}] {cname} (reply): {cbody}")

    return _truncate_transcript("\n\n".join(lines))


def normalize_llm_outcomes(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for x in raw:
        if not isinstance(x, dict):
            continue
        label = str(x.get("label") or "").strip()[:220]
        if not label:
            continue
        try:
            p = float(x.get("probability", 0.5))
        except (TypeError, ValueError):
            p = 0.5
        p = max(0.0, min(1.0, p))
        impact = str(x.get("impact") or "medium").lower().strip()
        if impact not in ("low", "medium", "high"):
            impact = "medium"
        out.append({"label": label, "probability": p, "impact": impact})
    return out[:8]


def normalize_llm_string_list(raw: Any, *, cap: int = 12, max_len: int = 480) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw:
        s = str(x).strip()
        if s:
            out.append(s[:max_len])
        if len(out) >= cap:
            break
    return out


async def synthesize_report_from_conversations(
    *,
    simulation_name: str,
    simulation_description: str,
    current_round: int,
    transcript: str,
    compact_stats: str,
    baseline_key_outcomes: list[dict[str, Any]],
    baseline_risk_factors: list[str],
    baseline_causal_drivers: list[str],
) -> dict[str, Any] | None:
    """Returns parsed LLM JSON or None if GenAI off or call failed."""
    if not is_llm_available():
        return None

    if not transcript.strip():
        transcript = "(No posts or comments are recorded for this simulation yet.)"

    prompt = f"""You assess multi-agent policy simulations for executive readers.

Simulation name: {simulation_name}
Description: {simulation_description or "(none)"}
Latest round index: {current_round}

System-derived stats (trust the numbers; interpret them with the dialogue):
{compact_stats}

Algorithmic baselines (refine or replace if the conversation clearly supports different conclusions):
- key outcomes: {json.dumps(baseline_key_outcomes, ensure_ascii=False)}
- risks: {json.dumps(baseline_risk_factors, ensure_ascii=False)}
- drivers: {json.dumps(baseline_causal_drivers, ensure_ascii=False)}

--- Simulated social feed (posts and replies) ---
{transcript}
--- end feed ---

Return ONE JSON object only. No markdown fences. Keys:
- "executiveSummary": string, 2-4 short paragraphs of plain business English. Quote themes from the threads, name tensions, and say what leadership should watch. If the feed is empty or tiny, say that clearly.
- "keyOutcomes": array of 3-5 objects with "label", "probability" (0-1), "impact" ("low"|"medium"|"high"), grounded in both stats and dialogue.
- "riskFactors": array of 4-10 concise strings observable from the threads or stats.
- "causalDrivers": array of 4-10 concise strings naming mechanisms evident in the conversation (framing, trust, backlash, coalition patterns), not generic network jargon unless the text supports it."""

    try:
        raw = (
            await call_pwc_genai_async(
                prompt,
                task_name="simulation_report",
                temperature=0.35,
                max_tokens=2800,
            )
        ).strip()
        m = re.search(r"\{[\s\S]*\}\s*$", raw) or re.search(r"\{[\s\S]*\}", raw)
        if not m:
            logger.warning("simulation_report LLM: no JSON object in response")
            return None
        parsed = json.loads(m.group(0))
        if not isinstance(parsed, dict):
            return None
        return parsed
    except Exception as exc:
        logger.warning("simulation_report LLM failed (%s): %s", type(exc).__name__, exc)
        return None
