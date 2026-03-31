import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import init_auth
from app.config import CORS_ORIGINS, PORT, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW
from app.db import close_pool, init_pool
from app.rate_limit import init_rate_limiter
from app.routers import api_router
from app.services import llm_service
from app.services import neo4j_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auth & rate limiter (synchronous, fast)
    init_auth()
    init_rate_limiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)

    # Database pool (required)
    await init_pool()

    # Optional services (Neo4j, LLM) — init in parallel
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

# CORS — scoped origins for production, "*" for dev
origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "predictive-engine-api", "docs": "/docs"}
