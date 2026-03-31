import asyncio

from fastapi import APIRouter, HTTPException, Query, Response

from app.db import pool
from app.serialize import agent_row, influence_row, post_row
from app.services import neo4j_service

router = APIRouter()


@router.get("/agents")
async def list_agents(simulationId: str | None = Query(None)) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        if simulationId:
            sid = int(simulationId)
            rows = await conn.fetch(
                "SELECT * FROM agents WHERE simulation_id = $1", sid
            )
        else:
            rows = await conn.fetch("SELECT * FROM agents ORDER BY created_at")
    return [agent_row(r) for r in rows]


@router.post("/agents", status_code=201)
async def create_agent(body: dict) -> dict:
    required = (
        "name",
        "age",
        "gender",
        "region",
        "occupation",
        "persona",
        "stance",
    )
    for k in required:
        if k not in body:
            raise HTTPException(status_code=400, detail={"error": f"missing {k}"})

    bs = body.get(
        "beliefState",
        {"policySupport": 0, "trustInGovernment": 0.5, "economicOutlook": 0.5},
    )
    import json

    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO agents (
            name, age, gender, region, occupation, persona, stance,
            influence_score, credibility_score, belief_state, confidence_level,
            activity_level, group_id, simulation_id, system_prompt
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
            RETURNING *""",
            body["name"],
            int(body["age"]),
            body["gender"],
            body["region"],
            body["occupation"],
            body["persona"],
            body["stance"],
            float(body.get("influenceScore", 0.5)),
            float(body.get("credibilityScore", 0.5)),
            json.dumps(bs),
            float(body.get("confidenceLevel", 0.5)),
            float(body.get("activityLevel", 0.5)),
            body.get("groupId"),
            body.get("simulationId"),
            body.get("systemPrompt"),
        )
    out = agent_row(row)
    asyncio.create_task(neo4j_service.sync_agent_to_graph(out))
    return out


@router.get("/agents/{id}")
async def get_agent(id: int) -> dict:
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agents WHERE id = $1", id)
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Agent not found"})
    return agent_row(row)


@router.patch("/agents/{id}")
async def update_agent(id: int, body: dict) -> dict:
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agents WHERE id = $1", id)
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        import json

        name = body["name"] if "name" in body else row["name"]
        stance = body["stance"] if "stance" in body else row["stance"]
        conf = float(
            body["confidenceLevel"]
            if "confidenceLevel" in body
            else row["confidence_level"]
        )
        act = float(
            body["activityLevel"]
            if "activityLevel" in body
            else row["activity_level"]
        )
        inf = float(
            body["influenceScore"]
            if "influenceScore" in body
            else row["influence_score"]
        )
        cred = float(
            body["credibilityScore"]
            if "credibilityScore" in body
            else row["credibility_score"]
        )
        b = row["belief_state"]
        if isinstance(b, str):
            b = json.loads(b)
        if "beliefState" in body:
            b = body["beliefState"]

        row = await conn.fetchrow(
            """UPDATE agents SET name=$1, stance=$2, belief_state=$3::jsonb,
            confidence_level=$4, activity_level=$5, influence_score=$6, credibility_score=$7
            WHERE id = $8 RETURNING *""",
            name,
            stance,
            json.dumps(b),
            conf,
            act,
            inf,
            cred,
            id,
        )
    return agent_row(row)


@router.delete("/agents/{id}", status_code=204)
async def delete_agent(id: int) -> Response:
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "DELETE FROM agents WHERE id = $1 RETURNING id", id
        )
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})
    return Response(status_code=204)


@router.get("/agents/{id}/neighborhood")
async def agent_neighborhood(id: int) -> dict:
    p = pool()
    async with p.acquire() as conn:
        agent = await conn.fetchrow("SELECT * FROM agents WHERE id = $1", id)
        if not agent:
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        outgoing = await conn.fetch(
            "SELECT * FROM influences WHERE source_agent_id = $1", id
        )
        incoming = await conn.fetch(
            "SELECT * FROM influences WHERE target_agent_id = $1", id
        )

        neighbor_ids = set()
        for inf in outgoing:
            neighbor_ids.add(inf["target_agent_id"])
        for inf in incoming:
            neighbor_ids.add(inf["source_agent_id"])

        connections = []
        for nid in neighbor_ids:
            neighbor = await conn.fetchrow("SELECT * FROM agents WHERE id = $1", nid)
            if neighbor:
                out_inf = next(
                    (i for i in outgoing if i["target_agent_id"] == nid), None
                )
                in_inf = next(
                    (i for i in incoming if i["source_agent_id"] == nid), None
                )
                w = 0.0
                direction = "incoming"
                if out_inf:
                    w = float(out_inf["weight"])
                    direction = "outgoing"
                elif in_inf:
                    w = float(in_inf["weight"])
                connections.append(
                    {
                        "agent": agent_row(neighbor),
                        "influenceWeight": w,
                        "direction": direction,
                    }
                )

        posts = await conn.fetch(
            "SELECT * FROM posts WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20",
            id,
        )
        posts_out = [
            post_row(pr, agent_name=agent["name"], agent=agent) for pr in posts
        ]

    return {
        "agent": agent_row(agent),
        "connections": connections,
        "posts": posts_out,
    }


@router.post("/influences", status_code=201)
async def create_influence(body: dict) -> dict:
    for k in ("sourceAgentId", "targetAgentId", "weight"):
        if k not in body:
            raise HTTPException(status_code=400, detail={"error": f"missing {k}"})
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO influences (source_agent_id, target_agent_id, weight)
               VALUES ($1, $2, $3) RETURNING *""",
            int(body["sourceAgentId"]),
            int(body["targetAgentId"]),
            float(body["weight"]),
        )
    out = influence_row(row)
    asyncio.create_task(
        neo4j_service.sync_influence_to_graph(
            int(body["sourceAgentId"]),
            int(body["targetAgentId"]),
            float(body["weight"]),
        )
    )
    return out
