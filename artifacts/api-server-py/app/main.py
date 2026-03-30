import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import PORT
from app.db import close_pool, init_pool
from app.routers import api_router
from app.services import llm_service
from app.services import neo4j_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    results = await asyncio.gather(
        neo4j_service.init_neo4j(),
        llm_service.init_llm(),
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, Exception):
            logger.warning("Optional service init: %s", r)
    yield
    await neo4j_service.close_neo4j()
    await close_pool()


app = FastAPI(title="Predictive Engine API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "predictive-engine-api", "docs": "/docs"}
