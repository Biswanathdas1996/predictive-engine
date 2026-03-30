import asyncio

from fastapi import APIRouter, HTTPException

from app.db import pool
from app.serialize import policy_row
from app.services import neo4j_service

router = APIRouter()


@router.get("/policies")
async def list_policies() -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM policies ORDER BY created_at DESC"
        )
    return [policy_row(r) for r in rows]


@router.post("/policies", status_code=201)
async def create_policy(body: dict) -> dict:
    title = body.get("title")
    summary = body.get("summary")
    if not title or not summary:
        raise HTTPException(status_code=400, detail={"error": "title and summary required"})
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO policies (title, summary) VALUES ($1, $2) RETURNING *",
            title,
            summary,
        )
    out = policy_row(row)
    asyncio.create_task(neo4j_service.sync_policy_to_graph(out))
    return out
