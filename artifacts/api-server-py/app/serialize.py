from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import asyncpg


def _dt(v: datetime | None) -> str | None:
    if v is None:
        return None
    return v.isoformat()


def agent_row(r: asyncpg.Record) -> dict[str, Any]:
    bs = r["belief_state"]
    if isinstance(bs, str):
        bs = json.loads(bs)
    return {
        "id": r["id"],
        "name": r["name"],
        "age": r["age"],
        "gender": r["gender"],
        "region": r["region"],
        "occupation": r["occupation"],
        "persona": r["persona"],
        "stance": r["stance"],
        "influenceScore": float(r["influence_score"]),
        "credibilityScore": float(r["credibility_score"]),
        "beliefState": bs,
        "confidenceLevel": float(r["confidence_level"]),
        "activityLevel": float(r["activity_level"]),
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


def post_row(r: asyncpg.Record, *, agent_name: str | None = None) -> dict[str, Any]:
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
    return out


def comment_row(r: asyncpg.Record, *, agent_name: str) -> dict[str, Any]:
    return {
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
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "createdAt": _dt(r["created_at"]),
    }


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
