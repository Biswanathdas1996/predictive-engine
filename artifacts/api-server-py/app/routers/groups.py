from fastapi import APIRouter, HTTPException

from app.db import pool
from app.serialize import group_row

router = APIRouter()


@router.get("/groups")
async def list_groups() -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM groups ORDER BY created_at DESC")
    return [group_row(r) for r in rows]


@router.post("/groups", status_code=201)
async def create_group(body: dict) -> dict:
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail={"error": "name required"})
    desc = body.get("description", "")
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO groups (name, description) VALUES ($1, $2) RETURNING *",
            name,
            desc,
        )
    return group_row(row)
