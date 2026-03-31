import asyncio
import json
import random

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import require_auth
from app.db import pool
from app.models import (
    CreateGroupWithAgentsRequest,
    SuggestGroupCohortFieldsRequest,
    SuggestGroupCohortFieldsResponse,
)
from app.rate_limit import rate_limit_dependency
from app.serialize import agent_row, group_row
from app.services import agent_cohort
from app.services import neo4j_service

router = APIRouter()

_AGENT_INSERT = """INSERT INTO agents (
    name, age, gender, region, occupation, persona, stance,
    influence_score, credibility_score, belief_state, confidence_level,
    activity_level, group_id, simulation_id, system_prompt
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING id"""


async def _seed_pool_influences(conn, agent_ids: list[int]) -> None:
    n = len(agent_ids)
    if n < 2:
        return
    for i, aid in enumerate(agent_ids):
        num_conn = random.randint(1, min(4, n - 1))
        others = [j for j in range(n) if j != i]
        for _ in range(num_conn):
            j = random.choice(others)
            tid = agent_ids[j]
            weight = 0.2 + random.random() * 0.6
            await conn.execute(
                """INSERT INTO influences (source_agent_id, target_agent_id, weight)
                   VALUES ($1, $2, $3)""",
                aid,
                tid,
                weight,
            )


@router.get("/groups")
async def list_groups() -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT g.*,
                   (SELECT count(*)::int FROM agents a
                    WHERE a.group_id = g.id AND a.simulation_id IS NULL) AS pool_agent_count
            FROM groups g
            ORDER BY g.created_at DESC
            """
        )
    return [group_row(r) for r in rows]


@router.post("/groups", status_code=201)
async def create_group(body: dict) -> dict:
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail={"error": "name required"})
    desc = body.get("description", "")
    spec = body.get("cohortSpec") or {}
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO groups (name, description, cohort_spec)
               VALUES ($1, $2, $3::jsonb) RETURNING *""",
            name,
            desc,
            json.dumps(spec),
        )
    return group_row(row)


@router.delete("/groups/{id}", status_code=204)
async def delete_group(id: int) -> Response:
    """Remove the group, pool agents (simulation_id IS NULL), and clear group_id on simulation clones."""
    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", id)
            if not row:
                raise HTTPException(
                    status_code=404, detail={"error": "Group not found"}
                )

            pool_ids = [
                r["id"]
                for r in await conn.fetch(
                    "SELECT id FROM agents WHERE group_id = $1 AND simulation_id IS NULL",
                    id,
                )
            ]
            if pool_ids:
                await conn.execute(
                    """DELETE FROM influences
                       WHERE source_agent_id = ANY($1::int[])
                          OR target_agent_id = ANY($1::int[])""",
                    pool_ids,
                )
                await conn.execute(
                    "DELETE FROM agents WHERE id = ANY($1::int[])", pool_ids
                )

            await conn.execute(
                "UPDATE agents SET group_id = NULL WHERE group_id = $1", id
            )
            await conn.execute("DELETE FROM groups WHERE id = $1", id)

    return Response(status_code=204)


@router.post(
    "/groups/suggest-cohort-fields",
    dependencies=[Depends(require_auth), Depends(rate_limit_dependency)],
)
async def suggest_group_cohort_fields(
    body: SuggestGroupCohortFieldsRequest,
) -> SuggestGroupCohortFieldsResponse:
    """Use PwC GenAI to prefill cohort form fields from group name and optional notes."""
    data = await agent_cohort.suggest_cohort_form_fields(
        group_name=body.name.strip(),
        description=(body.description or "").strip(),
    )
    return SuggestGroupCohortFieldsResponse(**data)


@router.post(
    "/groups/with-agents",
    status_code=201,
    dependencies=[Depends(require_auth), Depends(rate_limit_dependency)],
)
async def create_group_with_agents(body: CreateGroupWithAgentsRequest) -> dict:
    cohort_spec = {
        "agentCount": body.agentCount,
        "demographics": body.demographics,
        "community": body.community,
        "educationProfession": body.educationProfession,
    }
    desc = body.description.strip() or (
        f"Synthetic cohort ({body.agentCount} agents). "
        f"{body.demographics[:280]}"
    )

    agents_data = await agent_cohort.generate_cohort_agents(
        count=body.agentCount,
        group_name=body.name.strip(),
        demographics=body.demographics,
        community=body.community,
        education_profession=body.educationProfession,
    )

    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            grow = await conn.fetchrow(
                """INSERT INTO groups (name, description, cohort_spec)
                   VALUES ($1, $2, $3::jsonb) RETURNING *""",
                body.name.strip(),
                desc[:4000],
                json.dumps(cohort_spec),
            )
            gid = grow["id"]
            new_ids: list[int] = []
            for a in agents_data:
                row = await conn.fetchrow(
                    _AGENT_INSERT,
                    a["name"],
                    a["age"],
                    a["gender"],
                    a["region"],
                    a["occupation"],
                    a["persona"],
                    a["stance"],
                    a["influence_score"],
                    a["credibility_score"],
                    json.dumps(a["belief_state"]),
                    a["confidence_level"],
                    a["activity_level"],
                    gid,
                    None,
                    a["system_prompt"],
                )
                new_ids.append(row["id"])

            await _seed_pool_influences(conn, new_ids)

    g_out = group_row(grow)
    g_out["poolAgentCount"] = len(new_ids)

    for aid in new_ids:
        async with p.acquire() as c2:
            ag = await c2.fetchrow("SELECT * FROM agents WHERE id = $1", aid)
        if ag:
            asyncio.create_task(neo4j_service.sync_agent_to_graph(agent_row(ag)))

    if len(new_ids) >= 2 and neo4j_service.is_neo4j_available():
        async with p.acquire() as c3:
            inf_rows = await c3.fetch(
                """SELECT source_agent_id, target_agent_id, weight
                   FROM influences
                   WHERE source_agent_id = ANY($1::int[])""",
                new_ids,
            )
        for inf in inf_rows:
            asyncio.create_task(
                neo4j_service.sync_influence_to_graph(
                    inf["source_agent_id"],
                    inf["target_agent_id"],
                    float(inf["weight"]),
                )
            )

    return {
        "group": g_out,
        "agentsCreated": len(new_ids),
    }
