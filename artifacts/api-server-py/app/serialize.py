from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import asyncpg


def _dt(v: datetime | None) -> str | None:
    if v is None:
        return None
    return v.isoformat()


def normalize_belief_state_json(raw: Any) -> dict[str, float]:
    """Ensure policy/trust/econ keys exist (camelCase + snake_case); fill DB defaults when missing."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}

    def pick(keys: tuple[str, ...], default: float) -> float:
        for k in keys:
            if k not in raw:
                continue
            v = raw.get(k)
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                break
        return default

    ps = pick(("policySupport", "policy_support"), 0.0)
    tg = pick(("trustInGovernment", "trust_in_government"), 0.5)
    eo = pick(("economicOutlook", "economic_outlook"), 0.5)
    return {
        "policySupport": max(-1.0, min(1.0, ps)),
        "trustInGovernment": max(-1.0, min(1.0, tg)),
        "economicOutlook": max(-1.0, min(1.0, eo)),
    }


def _float_col(r: asyncpg.Record, col: str, default: float) -> float:
    v = r.get(col)
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def normalize_agent_demographics(r: asyncpg.Record) -> tuple[int, str, str, str]:
    """Age, gender, region, occupation with the same defaults as agent_row."""
    try:
        age = int(r["age"])
    except (TypeError, ValueError):
        age = 0
    if age < 18:
        age = 30

    gender = str(r.get("gender") or "").strip() or "unspecified"
    region = str(r.get("region") or "").strip() or "Unknown"
    occupation = str(r.get("occupation") or "").strip() or "Unknown"
    return age, gender, region, occupation


def agent_row(r: asyncpg.Record) -> dict[str, Any]:
    bs = normalize_belief_state_json(r["belief_state"])

    cred = _float_col(r, "credibility_score", 0.5)
    act = _float_col(r, "activity_level", 0.5)
    # Legacy / corrupt rows sometimes have both stuck at 0 while influence is set.
    if cred <= 0.0 and act <= 0.0 and _float_col(r, "influence_score", 0.0) > 0.01:
        cred, act = 0.5, 0.5

    age, gender, region, occupation = normalize_agent_demographics(r)
    persona = str(r.get("persona") or "").strip()
    if not persona:
        persona = (
            f"{occupation} in {region}; participates in community and policy discussions "
            f"with a {str(r.get('stance') or 'neutral')} baseline stance."
        )

    sp_raw = r.get("system_prompt")
    system_prompt = str(sp_raw).strip() if sp_raw else ""
    if not system_prompt:
        nm = str(r.get("name") or "Agent").strip()
        system_prompt = (
            f"You are {nm}, {occupation} in {region}. {persona[:900]} "
            "Stay consistently in this voice; ground reactions in your role and lived context."
        )[:4000]

    return {
        "id": r["id"],
        "name": r["name"],
        "age": age,
        "gender": gender,
        "region": region,
        "occupation": occupation,
        "persona": persona,
        "systemPrompt": system_prompt,
        "stance": r["stance"],
        "influenceScore": _float_col(r, "influence_score", 0.5),
        "credibilityScore": cred,
        "beliefState": bs,
        "confidenceLevel": _float_col(r, "confidence_level", 0.5),
        "activityLevel": act,
        "groupId": r["group_id"],
        "simulationId": r["simulation_id"],
        "createdAt": _dt(r["created_at"]),
    }


def simulation_row(
    r: asyncpg.Record, *, total_agents: int, total_posts: int
) -> dict[str, Any]:
    cfg = r["config"]
    if isinstance(cfg, str):
        cfg = json.loads(cfg)
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "status": r["status"],
        "currentRound": r["current_round"],
        "totalAgents": total_agents,
        "totalPosts": total_posts,
        "config": cfg,
        "createdAt": _dt(r["created_at"]),
    }


def post_row(
    r: asyncpg.Record,
    *,
    agent_name: str | None = None,
    agent: asyncpg.Record | None = None,
) -> dict[str, Any]:
    tags = r["topic_tags"]
    if tags is None:
        tags = []
    out: dict[str, Any] = {
        "id": r["id"],
        "content": r["content"],
        "sentiment": float(r["sentiment"]),
        "platform": r["platform"],
        "topicTags": list(tags),
        "round": r["round"],
        "agentId": r["agent_id"],
        "simulationId": r["simulation_id"],
        "createdAt": _dt(r["created_at"]),
    }
    if agent_name is not None:
        out["agentName"] = agent_name
    if agent is not None:
        age, gender, region, occupation = normalize_agent_demographics(agent)
        out["agentAge"] = age
        out["agentGender"] = gender
        out["agentRegion"] = region
        out["agentOccupation"] = occupation
    return out


def comment_row(
    r: asyncpg.Record,
    *,
    agent_name: str,
    agent: asyncpg.Record | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": r["id"],
        "content": r["content"],
        "sentiment": float(r["sentiment"]),
        "round": r["round"],
        "agentId": r["agent_id"],
        "agentName": agent_name,
        "postId": r["post_id"],
        "simulationId": r["simulation_id"],
        "createdAt": _dt(r["created_at"]),
    }
    if agent is not None:
        age, gender, region, occupation = normalize_agent_demographics(agent)
        out["agentAge"] = age
        out["agentGender"] = gender
        out["agentRegion"] = region
        out["agentOccupation"] = occupation
    return out


def policy_attachment_meta_row(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": r["id"],
        "policyId": r["policy_id"],
        "filename": r["filename"],
        "contentType": r["content_type"],
        "size": int(r["size"] or 0),
    }


def policy_row(
    r: asyncpg.Record,
    *,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": r["id"],
        "title": r["title"],
        "summary": r["summary"],
        "createdAt": _dt(r["created_at"]),
    }
    if attachments is not None:
        out["attachments"] = attachments
    return out


def group_row(r: asyncpg.Record) -> dict[str, Any]:
    cs = r.get("cohort_spec") or {}
    if isinstance(cs, str):
        cs = json.loads(cs)
    if cs is None:
        cs = {}
    out: dict[str, Any] = {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "cohortSpec": cs,
        "createdAt": _dt(r["created_at"]),
    }
    if "pool_agent_count" in r.keys():
        out["poolAgentCount"] = int(r["pool_agent_count"])
    return out


def event_row(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": r["id"],
        "type": r["type"],
        "description": r["description"],
        "impactScore": float(r["impact_score"]),
        "simulationId": r["simulation_id"],
        "createdAt": _dt(r["created_at"]),
    }


def influence_row(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": r["id"],
        "sourceAgentId": r["source_agent_id"],
        "targetAgentId": r["target_agent_id"],
        "weight": float(r["weight"]),
        "createdAt": _dt(r["created_at"]),
    }


def monte_carlo_run_row(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": r["id"],
        "simulationId": r["simulation_id"],
        "numRuns": r["num_runs"],
        "meanSupport": float(r["mean_support"]),
        "variance": float(r["variance"]),
        "minSupport": float(r["min_support"]),
        "maxSupport": float(r["max_support"]),
        "createdAt": _dt(r["created_at"]),
    }
