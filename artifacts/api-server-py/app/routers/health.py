from fastapi import APIRouter

from app.db import pool
from app.services.llm_service import get_llm_public_details, is_llm_available
from app.services.neo4j_service import get_neo4j_status

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/status")
async def service_status() -> dict[str, str]:
    database = "error"
    try:
        p = pool()
        async with p.acquire() as conn:
            await conn.fetchval("SELECT 1")
        database = "connected"
    except Exception:
        pass

    llm_extra = get_llm_public_details()
    return {
        "api": "ok",
        "database": database,
        "neo4j": get_neo4j_status(),
        "llm": "available" if is_llm_available() else "unavailable",
        "llmBackend": llm_extra["llmBackend"],
        "llmModel": llm_extra["llmModel"],
    }
