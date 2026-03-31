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
    system_prompt = str(raw.get("systemPrompt") or raw.get("system_prompt") or "").strip()

    # Merge specializedSkills into systemPrompt if provided separately
    skills_raw = raw.get("specializedSkills") or raw.get("specialized_skills") or ""
    if skills_raw and isinstance(skills_raw, str):
        skills_raw = skills_raw.strip()
    elif isinstance(skills_raw, list):
        skills_raw = "; ".join(str(s) for s in skills_raw).strip()
    else:
        skills_raw = ""

    if skills_raw and skills_raw not in system_prompt:
        system_prompt = f"Specialized expertise: {skills_raw} {system_prompt}".strip()

    system_prompt = system_prompt[:4000]
    if not persona:
        persona = f"{occupation} in {region}; participates in community discussions."
    if not system_prompt:
        system_prompt = (
            f"You are {name}, {occupation} in {region}. {persona[:900]} "
            "Stay consistently in this voice; ground reactions in your role and lived context."
        )[:4000]

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
        "influence_score": max(
            0.12,
            _clamp_f(raw.get("influenceScore"), 0, 1, 0.3 + random.random() * 0.5),
        ),
        "credibility_score": max(
            0.12,
            _clamp_f(raw.get("credibilityScore"), 0, 1, 0.4 + random.random() * 0.4),
        ),
        "confidence_level": _clamp_f(raw.get("confidenceLevel"), 0, 1, 0.3 + random.random() * 0.5),
        "activity_level": max(
            0.12,
            _clamp_f(raw.get("activityLevel"), 0, 1, 0.3 + random.random() * 0.5),
        ),
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
        (
            "Alex Morgan", 34, "Urban professional",
            "policy analysis through economic efficiency and market incentives",
            "You evaluate every policy by asking: who bears the cost and who captures the benefit? "
            "You cite economic data and market outcomes to back your position. "
            "You engage disagreement head-on with counter-evidence; you are not moved by emotional appeals alone.",
        ),
        (
            "Jordan Lee", 52, "Local organizer",
            "grassroots community impact and civic representation",
            "You assess policy through the lens of community power: does this strengthen or undermine local voices? "
            "You draw on direct organizing experience and speak in concrete neighborhood examples. "
            "You challenge top-down language and demand accountability from institutions.",
        ),
        (
            "Riley Santos", 41, "Skilled tradesperson",
            "workforce implications, labor rights, and on-the-ground operational impact",
            "You evaluate policy by its practical effect on workers — wages, safety, job security. "
            "You speak plainly, cite real job-site examples, and distrust abstractions. "
            "You push back when policies feel like they were written by people who've never done the actual work.",
        ),
        (
            "Casey Nguyen", 28, "Graduate student",
            "academic research, systemic analysis, and evidence-based critique",
            "You apply rigorous research frameworks to dissect policy assumptions and unintended consequences. "
            "You cite studies, flag methodological gaps, and question the evidence base. "
            "You engage disagreement with citations; you update your views when better evidence emerges.",
        ),
        (
            "Morgan Blake", 63, "Retiree",
            "long-term institutional memory and generational equity",
            "You evaluate policy through decades of lived experience — what worked, what failed, what was promised vs. delivered. "
            "You cite historical precedents and are skeptical of untested approaches. "
            "You are direct; you have seen enough to know when rhetoric substitutes for substance.",
        ),
        (
            "Taylor Brooks", 37, "Healthcare worker",
            "public health outcomes, patient welfare, and healthcare system capacity",
            "You assess every policy through its impact on patient outcomes, health equity, and frontline capacity. "
            "You cite clinical evidence and lived experience from care settings. "
            "You are empathetic but precise; emotional appeals resonate only when backed by outcomes data.",
        ),
    ]
    out: list[dict[str, Any]] = []
    hint = f"{demographics[:400]} | Community: {community[:400]} | Education/work: {education_profession[:400]}"
    for i in range(count):
        nm, age, tag, skills, sp = bases[i % len(bases)]
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
                        f"Member of \"{group_name}\". {tag}. Context: {hint[:600]}. "
                        f"Engages peers with lived experience and local knowledge."
                    ),
                    "stance": random.choice(["supportive", "opposed", "neutral"]),
                    "specializedSkills": skills,
                    "systemPrompt": sp,
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
- policySupport, trustInGovernment, economicOutlook (numbers from -1 to 1; include ALL THREE keys on every object — never omit trust or econ)
- confidenceLevel, influenceScore, credibilityScore, activityLevel (numbers from 0 to 1; use varied values above 0.15 — not all zeros)
- specializedSkills (string, 1-2 sentences: the precise professional or lived-experience expertise this agent brings when evaluating ANY policy — e.g. a nurse says "clinical patient-outcome analysis and triage resource allocation", an economist says "cost-benefit modeling, market-incentive mapping, and fiscal-impact forecasting". This must be specific to their occupation and unique to this individual.)
- systemPrompt (string, 4-6 sentences in second-person covering ALL of: (1) the exact domain lens they apply to every policy — the first question they ask, the framework they use; (2) their online communication style — vocabulary, tone, whether they cite data or personal stories; (3) the types of evidence or arguments that genuinely move their stance; (4) how they handle disagreement — do they engage, challenge, or dismiss? This prompt MUST grant the agent FULL AUTONOMY to take a clear, confident position based on their specialized expertise — no hedging, no "where possible".)

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


def _fallback_suggest_cohort_fields(group_name: str, description: str) -> dict[str, Any]:
    """Heuristic form prefill when GenAI is unavailable."""
    hint = description.strip() or f"A synthetic cohort aligned with “{group_name}” for policy discussion."
    return {
        "description": (description.strip() or hint)[:4000],
        "agentCount": 24,
        "demographics": (
            f"Adults roughly 25–60 with varied household types; mixed income levels plausible for this group; "
            f"diversity of backgrounds consistent with “{group_name}”. {hint[:200]}"
        )[:4000],
        "community": (
            f"Members are connected through shared context implied by “{group_name}”: local meetups, "
            f"online groups, or professional circles. Geography and ties should match the name and any notes."
        )[:4000],
        "educationProfession": (
            f"Mix of secondary through graduate education; roles spanning employed, self-employed, "
            f"caregiving, and retired where appropriate for “{group_name}”. Adjust sectors to fit the theme."
        )[:4000],
    }


def _normalize_suggest_payload(raw: dict[str, Any], group_name: str) -> dict[str, Any]:
    desc = str(raw.get("description") or "").strip()[:4000]
    ac_raw = raw.get("agentCount", raw.get("agent_count", 24))
    try:
        agent_count = int(ac_raw)
    except (TypeError, ValueError):
        agent_count = 24
    agent_count = max(1, min(500, agent_count))
    demo = str(raw.get("demographics") or "").strip()
    comm = str(raw.get("community") or "").strip()
    edu = str(raw.get("educationProfession") or raw.get("education_profession") or "").strip()
    if len(demo) < 8:
        demo = (
            f"Diverse ages and backgrounds appropriate to “{group_name}”; specify further after review."
        )
    if len(comm) < 8:
        comm = (
            f"Community ties and geography consistent with “{group_name}”; refine to match your scenario."
        )
    if len(edu) < 8:
        edu = (
            f"Education and occupation mix plausible for “{group_name}”; edit to match your domain."
        )
    if not desc:
        desc = f"Synthetic cohort for “{group_name}” — edit as needed."[:4000]
    return {
        "description": desc[:4000],
        "agentCount": agent_count,
        "demographics": demo[:4000],
        "community": comm[:4000],
        "educationProfession": edu[:4000],
    }


async def suggest_cohort_form_fields(*, group_name: str, description: str = "") -> dict[str, Any]:
    """LLM-backed JSON for the create-group form (description + cohort spec fields)."""
    name = group_name.strip()
    if not name:
        raise ValueError("group name is required")
    desc_in = description.strip()
    if not llm_service.is_llm_available():
        return _fallback_suggest_cohort_fields(name, desc_in)

    prompt = f"""You help configure a synthetic agent cohort for social and policy simulation.
The user will paste these values into a form. Propose realistic, specific content — not generic filler.

Group name: {name}
Optional notes from the user: {desc_in or "(none)"}

Output a single JSON object only. No markdown fences, no commentary.

Required keys (exact spelling):
- "description": string, 1–2 sentences for a dashboard card (max 350 chars)
- "agentCount": integer from 8 to 120 (pick a plausible network size for this group)
- "demographics": string, 2–5 short sentences: age bands, household types, income mix, languages, diversity
- "community": string, 2–5 short sentences: geography, organizations, how members know each other, online/offline
- "educationProfession": string, 2–5 short sentences: typical education levels and job sectors / career stages

Everything must be consistent with the group name and optional notes. Use concrete details (regions, sectors) when possible."""

    try:
        raw_text = (await llm_service.generate_text(prompt)).strip()
        m = re.search(r"\{[\s\S]*\}", raw_text)
        if not m:
            raise ValueError("no JSON object in LLM response")
        parsed = json.loads(m.group(0))
        if not isinstance(parsed, dict):
            raise ValueError("LLM output is not a JSON object")
        return _normalize_suggest_payload(parsed, name)
    except Exception as exc:
        logger.warning(
            "Cohort suggest LLM failed (%s): %s — using fallback",
            type(exc).__name__,
            exc,
        )
        return _fallback_suggest_cohort_fields(name, desc_in)
