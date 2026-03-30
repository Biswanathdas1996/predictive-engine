from fastapi import APIRouter

from app.routers import agents, comments, events, groups, health, policies, simulations

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(agents.router, tags=["agents"])
api_router.include_router(comments.router, tags=["comments"])
api_router.include_router(simulations.router, tags=["simulations"])
api_router.include_router(policies.router, tags=["policies"])
api_router.include_router(groups.router, tags=["groups"])
api_router.include_router(events.router, tags=["events"])
