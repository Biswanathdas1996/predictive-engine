import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.db import pool
from app.serialize import event_row
from app.services import neo4j_service

router = APIRouter()


@router.get("/events")
async def list_events(simulationId: int | None = Query(None)) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        if simulationId is not None:
            rows = await conn.fetch(
                """SELECT * FROM events WHERE simulation_id = $1
                   ORDER BY created_at DESC""",
                simulationId,
            )
        else:
            rows = await conn.fetch("SELECT * FROM events ORDER BY created_at DESC")
    return [event_row(r) for r in rows]


@router.post("/events", status_code=201)
async def create_event(body: dict) -> dict:
    for key in ("type", "description", "impactScore"):
        if key not in body:
            raise HTTPException(
                status_code=400, detail={"error": f"missing field: {key}"}
            )
    p = pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO events (type, description, impact_score, simulation_id)
               VALUES ($1, $2, $3, $4) RETURNING *""",
            body["type"],
            body["description"],
            float(body["impactScore"]),
            body.get("simulationId"),
        )
    out = event_row(row)
    asyncio.create_task(neo4j_service.sync_event_to_graph(out))
    return out
