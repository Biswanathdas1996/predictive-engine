"""LLM-backed synthetic agent cohort generation for agent groups."""

from __future__ import annotations

import json
import logging
import random
import re
from typing import Any

from app.services import llm_service

logger = logging.getLogger(__name__)

_VALID_STANCES = frozenset({"supportive", "opposed", "neutral", "radical"})


def _clamp_f(x: Any, lo: float, hi: float, default: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _normalize_stance(raw: Any) -> str:
    s = str(raw or "neutral").lower().strip()
    return s if s in _VALID_STANCES else "neutral"


def _normalize_agent_dict(raw: dict[str, Any], idx: int) -> dict[str, Any]:
    name = str(raw.get("name") or f"Synthetic agent {idx + 1}").strip()[:120]
    try:
        age = int(raw.get("age", 30))
    except (TypeError, ValueError):
        age = 30
    age = max(18, min(95, age))
    gender = str(raw.get("gender") or "unspecified").strip()[:32]
    region = str(raw.get("region") or "Unknown").strip()[:120]
    occupation = str(raw.get("occupation") or "Unknown").strip()[:120]
    persona = str(raw.get("persona") or "").strip()[:2000]
    stance = _normalize_stance(raw.get("stance"))
    system_prompt = str(raw.get("systemPrompt") or raw.get("system_prompt") or "").strip()[:4000]
    if not persona:
        persona = f"{occupation} in {region}; participates in community discussions."

    policy_support = _clamp_f(raw.get("policySupport"), -1, 1, (random.random() - 0.5) * 1.2)
    trust = _clamp_f(raw.get("trustInGovernment"), -1, 1, random.random() * 0.6 + 0.2)
    econ = _clamp_f(raw.get("economicOutlook"), -1, 1, (random.random() - 0.5) * 1.0)

    return {
        "name": name,
        "age": age,
        "gender": gender,
        "region": region,
        "occupation": occupation,
        "persona": persona,
        "stance": stance,
        "system_prompt": system_prompt or None,
        "belief_state": {
            "policySupport": policy_support,
            "trustInGovernment": trust,
            "economicOutlook": econ,
        },
        "influence_score": _clamp_f(raw.get("influenceScore"), 0, 1, 0.3 + random.random() * 0.5),
        "credibility_score": _clamp_f(raw.get("credibilityScore"), 0, 1, 0.4 + random.random() * 0.4),
        "confidence_level": _clamp_f(raw.get("confidenceLevel"), 0, 1, 0.3 + random.random() * 0.5),
        "activity_level": _clamp_f(raw.get("activityLevel"), 0, 1, 0.3 + random.random() * 0.5),
    }


def _fallback_cohort(
    count: int,
    *,
    group_name: str,
    demographics: str,
    community: str,
    education_profession: str,
) -> list[dict[str, Any]]:
    bases = [
        ("Alex Morgan", 34, "Urban professional"),
        ("Jordan Lee", 52, "Local organizer"),
        ("Riley Santos", 41, "Skilled tradesperson"),
        ("Casey Nguyen", 28, "Graduate student"),
        ("Morgan Blake", 63, "Retiree"),
        ("Taylor Brooks", 37, "Healthcare worker"),
    ]
    out: list[dict[str, Any]] = []
    hint = f"{demographics[:400]} | Community: {community[:400]} | Education/work: {education_profession[:400]}"
    for i in range(count):
        nm, age, tag = bases[i % len(bases)]
        suffix = f" #{i // len(bases) + 1}" if i >= len(bases) else ""
        out.append(
            _normalize_agent_dict(
                {
                    "name": f"{nm}{suffix}",
                    "age": age + (i % 7),
                    "gender": "varied",
                    "region": community.split(",")[0][:80] if community else "Regional",
                    "occupation": education_profession.split(",")[0][:80]
                    if education_profession
                    else "Community member",
                    "persona": (
                        f"Member of “{group_name}”. {tag}. Context: {hint[:600]}. "
                        f"Engages peers with lived experience and local knowledge."
                    ),
                    "stance": random.choice(["supportive", "opposed", "neutral"]),
                    "systemPrompt": (
                        "Stay consistent with your background and community ties. "
                        "Reference local concerns when relevant; avoid breaking character."
                    ),
                },
                i,
            )
        )
    return out


async def generate_cohort_agents(
    *,
    count: int,
    group_name: str,
    demographics: str,
    community: str,
    education_profession: str,
) -> list[dict[str, Any]]:
    """Return agent field dicts (no DB ids) suitable for bulk insert."""
    if not llm_service.is_llm_available():
        logger.info("LLM unavailable — using template cohort for group %r", group_name)
        return _fallback_cohort(
            count,
            group_name=group_name,
            demographics=demographics,
            community=community,
            education_profession=education_profession,
        )

    prompt = f"""You design a diverse synthetic population for social simulation.

Group name: {group_name}
Target size: exactly {count} distinct people.

User specifications:
- Demographics: {demographics}
- Community / geography / ties: {community}
- Education, qualifications, profession mix: {education_profession}

Output a single JSON array of {count} objects. No markdown, no commentary — only valid JSON.

Each object must have:
- name (string, realistic full name, unique in the array)
- age (integer 18-95)
- gender (string)
- region (string, where they live or identify)
- occupation (string)
- persona (string, 1-3 sentences: voice, values, media habits, how they talk online)
- stance: one of supportive | opposed | neutral | radical (policy attitude baseline)
- policySupport, trustInGovernment, economicOutlook (numbers from -1 to 1)
- confidenceLevel, influenceScore, credibilityScore, activityLevel (numbers from 0 to 1)
- systemPrompt (string, 2-5 sentences: behavioral instructions the simulator will use so this agent stays in character — speech style, taboos, what persuades them, how they treat disagreement)

Vary ages, stances, and personalities; keep everyone plausibly belonging to the same community thread described above."""

    try:
        raw = (
            await llm_service.call_pwc_genai_async(
                prompt,
                task_name="agent_cohort",
                temperature=0.65,
            )
        ).strip()
        m = re.search(r"\[[\s\S]*\]", raw)
        if not m:
            raise ValueError("no JSON array in LLM response")
        parsed = json.loads(m.group(0))
        if not isinstance(parsed, list):
            raise ValueError("LLM output is not a JSON array")
        normalized = [_normalize_agent_dict(x, i) for i, x in enumerate(parsed) if isinstance(x, dict)]
        if len(normalized) >= count:
            return normalized[:count]
        # pad with fallback if model returned too few
        short = count - len(normalized)
        logger.warning("LLM returned %s agents; padding %s", len(normalized), short)
        pad = _fallback_cohort(
            short,
            group_name=group_name,
            demographics=demographics,
            community=community,
            education_profession=education_profession,
        )
        return normalized + pad
    except Exception as exc:
        logger.warning("Cohort LLM failed (%s): %s — using fallback", type(exc).__name__, exc)
        return _fallback_cohort(
            count,
            group_name=group_name,
            demographics=demographics,
            community=community,
            education_profession=education_profession,
        )
