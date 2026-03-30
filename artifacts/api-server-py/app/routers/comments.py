from fastapi import APIRouter, HTTPException, Query

from app.db import pool
from app.serialize import comment_row

router = APIRouter()


@router.get("/posts/{postId}/comments")
async def list_post_comments(postId: int) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        comments = await conn.fetch(
            """SELECT * FROM comments WHERE post_id = $1
               ORDER BY created_at DESC""",
            postId,
        )
        agents = await conn.fetch("SELECT id, name FROM agents")
    name_by_id = {a["id"]: a["name"] for a in agents}
    return [
        comment_row(
            c, agent_name=name_by_id.get(c["agent_id"], "Unknown")
        )
        for c in comments
    ]


@router.post("/comments", status_code=201)
async def create_comment(body: dict) -> dict:
    for k in ("content", "sentiment", "round", "agentId", "postId", "simulationId"):
        if k not in body:
            raise HTTPException(status_code=400, detail={"error": f"missing {k}"})
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO comments
            (content, sentiment, round, agent_id, post_id, simulation_id)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
            body["content"],
            float(body["sentiment"]),
            int(body["round"]),
            int(body["agentId"]),
            int(body["postId"]),
            int(body["simulationId"]),
        )
    return {
        "id": row["id"],
        "content": row["content"],
        "sentiment": float(row["sentiment"]),
        "round": row["round"],
        "agentId": row["agent_id"],
        "postId": row["post_id"],
        "simulationId": row["simulation_id"],
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.get("/simulations/{simulationId}/comments")
async def list_simulation_comments(
    simulationId: int, limit: int = Query(50)
) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        comments = await conn.fetch(
            """SELECT * FROM comments WHERE simulation_id = $1
               ORDER BY created_at DESC LIMIT $2""",
            simulationId,
            limit,
        )
        agents = await conn.fetch(
            "SELECT id, name FROM agents WHERE simulation_id = $1", simulationId
        )
    name_by_id = {a["id"]: a["name"] for a in agents}
    return [
        comment_row(c, agent_name=name_by_id.get(c["agent_id"], "Unknown"))
        for c in comments
    ]
