import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

from app.auth import require_auth
from app.db import pool
from app.models import (
    CreateSimulationRequest,
    DecodeBeliefChartRequest,
    DecodeBeliefChartResponse,
    MonteCarloRequest,
    MonteCarloResultOut,
    PaginationParams,
    SimulationGraphOut,
    SimulationListOut,
    SimulationOut,
    SimulationReportOut,
)
from app.rate_limit import rate_limit_dependency
from app.serialize import (
    agent_row,
    comment_row,
    monte_carlo_run_row,
    post_row,
    simulation_row,
)
from app.services import belief_chart_decode, neo4j_service
from app.services.llm_service import is_llm_available
from app.services.simulation_engine import (
    run_monte_carlo,
    run_monte_carlo_stream,
    run_simulation_round,
    run_simulation_round_stream,
)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

logger = logging.getLogger(__name__)

router = APIRouter(
    dependencies=[Depends(rate_limit_dependency), Depends(require_auth)],
)

PERSONAS = [
    {
        "name": "Sarah Chen",
        "age": 34,
        "gender": "female",
        "region": "Urban",
        "occupation": "Software Engineer",
        "persona": "Tech-savvy urban professional concerned about economic growth",
        "stance": "supportive",
    },
    {
        "name": "Marcus Johnson",
        "age": 52,
        "gender": "male",
        "region": "Suburban",
        "occupation": "Small Business Owner",
        "persona": "Conservative business owner focused on tax policy",
        "stance": "opposed",
    },
    {
        "name": "Elena Rodriguez",
        "age": 28,
        "gender": "female",
        "region": "Urban",
        "occupation": "Social Worker",
        "persona": "Progressive advocate for social justice and equity",
        "stance": "supportive",
    },
    {
        "name": "Robert Williams",
        "age": 67,
        "gender": "male",
        "region": "Rural",
        "occupation": "Retired Teacher",
        "persona": "Moderate with traditional values and education focus",
        "stance": "neutral",
    },
    {
        "name": "Aisha Patel",
        "age": 41,
        "gender": "female",
        "region": "Suburban",
        "occupation": "Healthcare Worker",
        "persona": "Healthcare professional concerned about public health policy",
        "stance": "supportive",
    },
    {
        "name": "James Thompson",
        "age": 45,
        "gender": "male",
        "region": "Rural",
        "occupation": "Farmer",
        "persona": "Agricultural worker focused on environmental regulations",
        "stance": "opposed",
    },
    {
        "name": "Lisa Wang",
        "age": 31,
        "gender": "female",
        "region": "Urban",
        "occupation": "Journalist",
        "persona": "Media professional seeking balanced perspectives",
        "stance": "neutral",
    },
    {
        "name": "David Kumar",
        "age": 38,
        "gender": "male",
        "region": "Urban",
        "occupation": "University Professor",
        "persona": "Academic with evidence-based policy preferences",
        "stance": "neutral",
    },
    {
        "name": "Maria Garcia",
        "age": 55,
        "gender": "female",
        "region": "Suburban",
        "occupation": "Nurse",
        "persona": "Experienced healthcare worker with union ties",
        "stance": "supportive",
    },
    {
        "name": "Tom Anderson",
        "age": 23,
        "gender": "male",
        "region": "Urban",
        "occupation": "Student",
        "persona": "Young activist with radical policy reform views",
        "stance": "radical",
    },
    {
        "name": "Karen White",
        "age": 49,
        "gender": "female",
        "region": "Suburban",
        "occupation": "Accountant",
        "persona": "Fiscal conservative focused on government spending",
        "stance": "opposed",
    },
    {
        "name": "Michael Brown",
        "age": 60,
        "gender": "male",
        "region": "Rural",
        "occupation": "Factory Worker",
        "persona": "Blue collar worker concerned about job security",
        "stance": "neutral",
    },
]

_AGENT_INSERT_SQL = """INSERT INTO agents (
    name, age, gender, region, occupation, persona, stance,
    influence_score, credibility_score, belief_state, confidence_level,
    activity_level, group_id, simulation_id, system_prompt
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)"""


async def _resolve_config_with_groups(conn: asyncpg.Connection, cfg: dict) -> dict:
    raw = cfg.get("groupIds")
    if not raw:
        return cfg
    gids: list[int] = []
    for x in raw:
        try:
            xi = int(x)
        except (TypeError, ValueError):
            continue
        if xi > 0:
            gids.append(xi)
    gids = list(dict.fromkeys(gids))
    if not gids:
        c2 = {**cfg}
        c2["groupIds"] = None
        return c2
    n = await conn.fetchval(
        """SELECT count(*)::int FROM agents
           WHERE group_id = ANY($1::int[]) AND simulation_id IS NULL""",
        gids,
    )
    if not n:
        raise HTTPException(
            status_code=400,
            detail={"error": "no pool agents found for selected groups"},
        )
    return {**cfg, "groupIds": gids, "agentCount": int(n)}


async def _insert_simulation_agents(
    conn: asyncpg.Connection, sim_id: int, cfg: dict
) -> list[asyncpg.Record]:
    gids = cfg.get("groupIds")
    if gids:
        rows = await conn.fetch(
            """SELECT * FROM agents
               WHERE group_id = ANY($1::int[]) AND simulation_id IS NULL
               ORDER BY group_id, id""",
            gids,
        )
        if not rows:
            raise HTTPException(
                status_code=400,
                detail={"error": "no pool agents found for selected groups"},
            )
        for r in rows:
            bs = r["belief_state"]
            if isinstance(bs, str):
                bs = json.loads(bs)
            await conn.execute(
                _AGENT_INSERT_SQL,
                r["name"],
                int(r["age"]),
                r["gender"],
                r["region"],
                r["occupation"],
                r["persona"],
                r["stance"],
                float(r["influence_score"]),
                float(r["credibility_score"]),
                json.dumps(bs),
                float(r["confidence_level"]),
                float(r["activity_level"]),
                r["group_id"],
                sim_id,
                r.get("system_prompt"),
            )
    else:
        agent_count = int(cfg["agentCount"])
        for i in range(agent_count):
            template = PERSONAS[i % len(PERSONAS)]
            name = template["name"]
            if i >= len(PERSONAS):
                name = f"{template['name']} {i // len(PERSONAS) + 1}"
            await conn.execute(
                _AGENT_INSERT_SQL,
                name,
                template["age"],
                template["gender"],
                template["region"],
                template["occupation"],
                template["persona"],
                template["stance"],
                0.3 + random.random() * 0.5,
                0.4 + random.random() * 0.4,
                json.dumps({
                    "policySupport": (random.random() - 0.5) * 1.6,
                    "trustInGovernment": random.random() * 0.8 + 0.1,
                    "economicOutlook": (random.random() - 0.5) * 1.4,
                }),
                0.3 + random.random() * 0.5,
                0.3 + random.random() * 0.5,
                None,
                sim_id,
                None,
            )

    created = await conn.fetch(
        "SELECT * FROM agents WHERE simulation_id = $1 ORDER BY id", sim_id
    )
    return list(created)


async def _seed_simulation_influences(
    conn: asyncpg.Connection, agents_list: list[asyncpg.Record]
) -> None:
    n_agents = len(agents_list)
    if n_agents < 2:
        return
    for i, ag in enumerate(agents_list):
        num_conn = random.randint(1, 3)
        for _ in range(num_conn):
            others = [j for j in range(n_agents) if j != i]
            j = random.choice(others)
            weight = 0.2 + random.random() * 0.6
            await conn.execute(
                """INSERT INTO influences (source_agent_id, target_agent_id, weight)
                   VALUES ($1, $2, $3)""",
                ag["id"],
                agents_list[j]["id"],
                weight,
            )


# ---------------------------------------------------------------------------
# GET /simulations  —  paginated, single query (fixes N+1)
# ---------------------------------------------------------------------------
@router.get("/simulations")
async def list_simulations(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    p = pool()
    async with p.acquire() as conn:
        # Single query with sub-selects instead of N+1 count loops
        rows = await conn.fetch(
            """
            SELECT s.*,
                   (SELECT count(*)::int FROM agents  WHERE simulation_id = s.id) AS total_agents,
                   (SELECT count(*)::int FROM posts   WHERE simulation_id = s.id) AS total_posts
            FROM simulations s
            ORDER BY s.created_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        total = await conn.fetchval("SELECT count(*)::int FROM simulations")

    items = []
    for r in rows:
        cfg = r["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        items.append({
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "status": r["status"],
            "currentRound": r["current_round"],
            "totalAgents": r["total_agents"],
            "totalPosts": r["total_posts"],
            "config": cfg,
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
        })

    return {"items": items, "total": total, "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# POST /simulations  —  wrapped in transaction
# ---------------------------------------------------------------------------
@router.post("/simulations", status_code=201)
async def create_simulation(body: CreateSimulationRequest) -> dict:
    cfg = body.config.model_dump()

    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            cfg = await _resolve_config_with_groups(conn, cfg)
            sim = await conn.fetchrow(
                """INSERT INTO simulations (name, description, config)
                   VALUES ($1, $2, $3::jsonb) RETURNING *""",
                body.name,
                body.description,
                json.dumps(cfg),
            )
            sim_id = sim["id"]

            agents_list = await _insert_simulation_agents(conn, sim_id, cfg)
            n_agents = len(agents_list)
            await _seed_simulation_influences(conn, agents_list)

    # Neo4j sync outside transaction (fire-and-forget, non-critical)
    for ag in agents_list:
        asyncio.create_task(neo4j_service.sync_agent_to_graph(agent_row(ag)))
    if n_agents >= 2 and neo4j_service.is_neo4j_available():
        # Sync influence edges to Neo4j so GRAPH_BACKEND=neo4j can read them
        async with pool().acquire() as _conn:
            inf_rows = await _conn.fetch(
                """SELECT source_agent_id, target_agent_id, weight
                   FROM influences
                   WHERE source_agent_id = ANY($1::int[])""",
                [ag["id"] for ag in agents_list],
            )
        for inf in inf_rows:
            asyncio.create_task(
                neo4j_service.sync_influence_to_graph(
                    inf["source_agent_id"], inf["target_agent_id"], float(inf["weight"])
                )
            )

    cfg_out = sim["config"]
    if isinstance(cfg_out, str):
        cfg_out = json.loads(cfg_out)
    return {
        "id": sim["id"],
        "name": sim["name"],
        "description": sim["description"],
        "status": sim["status"],
        "currentRound": sim["current_round"],
        "totalAgents": n_agents,
        "totalPosts": 0,
        "config": cfg_out,
        "createdAt": sim["created_at"].isoformat() if sim["created_at"] else None,
    }


# ---------------------------------------------------------------------------
# POST /simulations/create-stream  —  SSE streaming simulation creation
# ---------------------------------------------------------------------------
@router.post("/simulations/create-stream")
async def create_simulation_stream(body: CreateSimulationRequest) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            cfg = body.config.model_dump()

            yield _sse({"type": "status", "phase": "init", "message": "Creating simulation..."})

            p = pool()
            async with p.acquire() as conn:
                async with conn.transaction():
                    cfg = await _resolve_config_with_groups(conn, cfg)
                    sim = await conn.fetchrow(
                        """INSERT INTO simulations (name, description, config)
                           VALUES ($1, $2, $3::jsonb) RETURNING *""",
                        body.name,
                        body.description,
                        json.dumps(cfg),
                    )
                    sim_id = sim["id"]

                    yield _sse({
                        "type": "status",
                        "phase": "simulation_created",
                        "message": f"Simulation created (ID: {sim_id})",
                        "simulationId": sim_id,
                    })

                    agent_count = int(cfg["agentCount"])
                    yield _sse({
                        "type": "status",
                        "phase": "agents",
                        "message": (
                            f"Adding {agent_count} agents from groups…"
                            if cfg.get("groupIds")
                            else f"Creating {agent_count} agents…"
                        ),
                        "total": agent_count,
                    })

                    agents_list = await _insert_simulation_agents(conn, sim_id, cfg)
                    n_agents = len(agents_list)

                    for idx, ag in enumerate(agents_list):
                        if (idx + 1) % max(1, n_agents // 10) == 0 or idx == n_agents - 1:
                            yield _sse({
                                "type": "status",
                                "phase": "agents",
                                "message": f"Created agent {idx + 1}/{n_agents}: {ag['name']}",
                                "current": idx + 1,
                                "total": n_agents,
                                "agentName": ag["name"],
                            })

                    yield _sse({
                        "type": "status",
                        "phase": "influences",
                        "message": f"Creating influence network for {n_agents} agents...",
                    })

                    edges_created = 0
                    if n_agents >= 2:
                        for i, ag in enumerate(agents_list):
                            num_conn = random.randint(1, 3)
                            for _ in range(num_conn):
                                others = [j for j in range(n_agents) if j != i]
                                j = random.choice(others)
                                weight = 0.2 + random.random() * 0.6
                                await conn.execute(
                                    """INSERT INTO influences (source_agent_id, target_agent_id, weight)
                                       VALUES ($1, $2, $3)""",
                                    ag["id"],
                                    agents_list[j]["id"],
                                    weight,
                                )
                                edges_created += 1

                        yield _sse({
                            "type": "status",
                            "phase": "influences",
                            "message": f"Created {edges_created} influence edges",
                            "edgesCreated": edges_created,
                        })

            # Neo4j sync
            for ag in agents_list:
                asyncio.create_task(neo4j_service.sync_agent_to_graph(agent_row(ag)))

            cfg_out = sim["config"]
            if isinstance(cfg_out, str):
                cfg_out = json.loads(cfg_out)

            yield _sse({
                "type": "complete",
                "simulation": {
                    "id": sim["id"],
                    "name": sim["name"],
                    "description": sim["description"],
                    "status": sim["status"],
                    "currentRound": sim["current_round"],
                    "totalAgents": n_agents,
                    "totalPosts": 0,
                    "config": cfg_out,
                    "createdAt": sim["created_at"].isoformat() if sim["created_at"] else None,
                },
            })
        except Exception as exc:
            logger.exception("create-stream failed")
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ---------------------------------------------------------------------------
# GET /simulations/{id}
# ---------------------------------------------------------------------------
@router.get("/simulations/{id}")
async def get_simulation(id: int) -> dict:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            """SELECT s.*,
                      (SELECT count(*)::int FROM agents  WHERE simulation_id = s.id) AS total_agents,
                      (SELECT count(*)::int FROM posts   WHERE simulation_id = s.id) AS total_posts
               FROM simulations s WHERE s.id = $1""",
            id,
        )
        if not sim:
            raise HTTPException(status_code=404, detail={"error": "Simulation not found"})
    cfg = sim["config"]
    if isinstance(cfg, str):
        cfg = json.loads(cfg)
    return {
        "id": sim["id"],
        "name": sim["name"],
        "description": sim["description"],
        "status": sim["status"],
        "currentRound": sim["current_round"],
        "totalAgents": sim["total_agents"],
        "totalPosts": sim["total_posts"],
        "config": cfg,
        "createdAt": sim["created_at"].isoformat() if sim["created_at"] else None,
    }


# ---------------------------------------------------------------------------
# DELETE /simulations/{id}  —  simplified with FK cascading deletes
# ---------------------------------------------------------------------------
@router.delete("/simulations/{id}", status_code=204)
async def delete_simulation(id: int) -> Response:
    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            sim = await conn.fetchrow("SELECT id FROM simulations WHERE id = $1", id)
            if not sim:
                raise HTTPException(status_code=404, detail={"error": "Simulation not found"})

            # With ON DELETE CASCADE on FKs, deleting agents cascades to
            # influences, and deleting simulations cascades to agents, posts,
            # comments, belief_snapshots, monte_carlo_runs.
            # But for DBs that haven't migrated yet, keep explicit deletes as fallback.
            await conn.execute("DELETE FROM comments WHERE simulation_id = $1", id)
            await conn.execute("DELETE FROM posts WHERE simulation_id = $1", id)
            await conn.execute("DELETE FROM belief_snapshots WHERE simulation_id = $1", id)
            await conn.execute("DELETE FROM monte_carlo_runs WHERE simulation_id = $1", id)
            agents = await conn.fetch("SELECT id FROM agents WHERE simulation_id = $1", id)
            for a in agents:
                await conn.execute(
                    "DELETE FROM influences WHERE source_agent_id = $1 OR target_agent_id = $1",
                    a["id"],
                )
            await conn.execute("DELETE FROM agents WHERE simulation_id = $1", id)
            await conn.execute("DELETE FROM simulations WHERE id = $1", id)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /simulations/{id}/run  —  with advisory lock to prevent concurrent runs
# ---------------------------------------------------------------------------
@router.post("/simulations/{id}/run")
async def run_round(id: int) -> dict:
    try:
        return await run_simulation_round(id)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail={"error": msg}) from e
        raise HTTPException(status_code=400, detail={"error": msg}) from e


# ---------------------------------------------------------------------------
# POST /simulations/{id}/run-stream  —  SSE streaming version
# ---------------------------------------------------------------------------
@router.post("/simulations/{id}/run-stream")
async def run_round_stream(id: int) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in run_simulation_round_stream(id):
                yield _sse(event)
        except Exception as exc:
            logger.exception("run-stream failed for simulation %s", id)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ---------------------------------------------------------------------------
# GET /simulations/{id}/posts  —  paginated
# ---------------------------------------------------------------------------
@router.get("/simulations/{id}/posts")
async def get_simulation_posts(
    id: int,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    p = pool()
    async with p.acquire() as conn:
        posts = await conn.fetch(
            """SELECT * FROM posts WHERE simulation_id = $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
            id,
            limit,
            offset,
        )
        total = await conn.fetchval(
            "SELECT count(*)::int FROM posts WHERE simulation_id = $1", id
        )
        agents = await conn.fetch(
            "SELECT id, name FROM agents WHERE simulation_id = $1", id
        )
    amap = {a["id"]: a["name"] for a in agents}
    return {
        "items": [post_row(pr, agent_name=amap.get(pr["agent_id"], "Unknown")) for pr in posts],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /simulations/{id}/graph
# ---------------------------------------------------------------------------
@router.get("/simulations/{id}/graph")
async def get_simulation_graph(id: int) -> dict:
    """Agents, influence edges, and conversation (posts + comments) for graph UI."""
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow("SELECT id FROM simulations WHERE id = $1", id)
        if not sim:
            raise HTTPException(status_code=404, detail={"error": "Simulation not found"})

        agents = await conn.fetch(
            "SELECT * FROM agents WHERE simulation_id = $1 ORDER BY id", id
        )
        agent_ids = [a["id"] for a in agents]
        influences = (
            await conn.fetch(
                """SELECT * FROM influences
                   WHERE source_agent_id = ANY($1::int[])
                     AND target_agent_id = ANY($1::int[])""",
                agent_ids,
            )
            if agent_ids
            else []
        )
        posts = await conn.fetch(
            """SELECT * FROM posts WHERE simulation_id = $1
               ORDER BY round ASC, created_at ASC LIMIT 300""",
            id,
        )
        try:
            comments = await conn.fetch(
                """SELECT * FROM comments WHERE simulation_id = $1
                   ORDER BY round ASC, created_at ASC LIMIT 300""",
                id,
            )
        except asyncpg.exceptions.UndefinedTableError:
            logger.warning(
                "comments table missing — graph will omit replies. Run: pnpm db:push"
            )
            comments = []
        amap = {a["id"]: a["name"] for a in agents}

    nodes: list[dict] = []
    for a in agents:
        row = agent_row(a)
        bs = row["beliefState"]
        nodes.append(
            {
                "id": row["id"],
                "name": row["name"],
                "stance": row["stance"],
                "influenceScore": row["influenceScore"],
                "policySupport": bs["policySupport"],
                "confidenceLevel": row["confidenceLevel"],
                "age": row["age"],
                "gender": row["gender"],
                "region": row["region"],
                "occupation": row["occupation"],
                "persona": row["persona"],
                "systemPrompt": row.get("systemPrompt"),
                "credibilityScore": row["credibilityScore"],
                "activityLevel": row["activityLevel"],
                "beliefState": bs,
                "groupId": row.get("groupId"),
            }
        )

    # Build edges dynamically from comment interactions:
    # When agent B comments on agent A's post → edge from B to A.
    # At round 0 (no comments yet) the graph has zero edges; edges grow
    # as agents reply to each other during the simulation.
    post_author: dict[int, int] = {p["id"]: p["agent_id"] for p in posts}
    edge_counts: dict[tuple[int, int], int] = {}
    for c in comments:
        commenter_id = c["agent_id"]
        author_id = post_author.get(c["post_id"])
        if author_id is None or commenter_id == author_id:
            continue
        key = (commenter_id, author_id)
        edge_counts[key] = edge_counts.get(key, 0) + 1

    # Look up pre-seeded influence weights for sizing (optional)
    inf_weights: dict[tuple[int, int], float] = {
        (inf["source_agent_id"], inf["target_agent_id"]): float(inf["weight"])
        for inf in influences
    }

    edges = [
        {
            "source": src,
            "target": tgt,
            "weight": inf_weights.get((src, tgt), 0.5),
        }
        for (src, tgt) in edge_counts
    ]

    posts_out = [
        post_row(pr, agent_name=amap.get(pr["agent_id"], "Unknown")) for pr in posts
    ]
    comments_out = [
        comment_row(c, agent_name=amap.get(c["agent_id"], "Unknown")) for c in comments
    ]

    return {
        "simulationId": id,
        "nodes": nodes,
        "edges": edges,
        "posts": posts_out,
        "comments": comments_out,
    }


# ---------------------------------------------------------------------------
# POST /simulations/{id}/decode-belief-chart  —  PwC GenAI layman narrative
# ---------------------------------------------------------------------------
@router.post("/simulations/{id}/decode-belief-chart")
async def decode_belief_chart(
    id: int,
    body: DecodeBeliefChartRequest,
) -> DecodeBeliefChartResponse:
    if not is_llm_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "PwC GenAI is not configured or unavailable",
                "hint": "Set PWC_GENAI_API_KEY or PWC_GENAI_BEARER_TOKEN and ensure the service can reach the gateway.",
            },
        )

    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT name, description, current_round FROM simulations WHERE id = $1",
            id,
        )
    if not sim:
        raise HTTPException(status_code=404, detail={"error": "Simulation not found"})

    series_dicts = [p.model_dump() for p in body.series]
    try:
        report = await belief_chart_decode.decode_belief_chart_report(
            simulation_name=sim["name"] or "",
            simulation_description=(sim["description"] or "").strip(),
            current_round=int(sim["current_round"] or 0),
            series=series_dicts,
        )
    except Exception as exc:
        logger.exception("belief chart decode failed for simulation %s", id)
        raise HTTPException(
            status_code=502,
            detail={"error": "GenAI decode failed", "message": str(exc)},
        ) from exc

    return DecodeBeliefChartResponse(report=report)


# ---------------------------------------------------------------------------
# POST /montecarlo/{simulationId}  —  background job support
# ---------------------------------------------------------------------------
@router.post("/montecarlo/{simulationId}")
async def montecarlo_run(
    simulationId: int, body: MonteCarloRequest = MonteCarloRequest()
) -> dict:
    num_runs = body.numRuns
    rounds_per_run = body.roundsPerRun
    try:
        result = await run_monte_carlo(simulationId, num_runs, rounds_per_run)
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)}) from e

    p = pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """INSERT INTO monte_carlo_runs
                (simulation_id, num_runs, mean_support, variance, min_support, max_support, distribution)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)""",
                simulationId,
                num_runs,
                result["meanSupport"],
                result["variance"],
                result["min"],
                result["max"],
                json.dumps(result["distribution"]),
            )
    return result


# ---------------------------------------------------------------------------
# POST /montecarlo/{simulationId}/stream  —  SSE streaming Monte Carlo
# ---------------------------------------------------------------------------
@router.post("/montecarlo/{simulationId}/stream")
async def montecarlo_run_stream(
    simulationId: int, body: MonteCarloRequest = MonteCarloRequest()
) -> StreamingResponse:
    num_runs = body.numRuns
    rounds_per_run = body.roundsPerRun

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in run_monte_carlo_stream(simulationId, num_runs, rounds_per_run):
                if event.get("type") == "complete":
                    # Persist the result before sending complete
                    result = event["result"]
                    p = pool()
                    async with p.acquire() as conn:
                        async with conn.transaction():
                            await conn.execute(
                                """INSERT INTO monte_carlo_runs
                                (simulation_id, num_runs, mean_support, variance, min_support, max_support, distribution)
                                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)""",
                                simulationId,
                                num_runs,
                                result["meanSupport"],
                                result["variance"],
                                result["min"],
                                result["max"],
                                json.dumps(result["distribution"]),
                            )
                    yield _sse({"type": "status", "phase": "saving", "message": "Results saved to database"})
                yield _sse(event)
        except Exception as exc:
            logger.exception("montecarlo-stream failed for simulation %s", simulationId)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ---------------------------------------------------------------------------
# GET /montecarlo/{simulationId}/runs  —  paginated
# ---------------------------------------------------------------------------
@router.get("/montecarlo/{simulationId}/runs")
async def montecarlo_runs(
    simulationId: int,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM monte_carlo_runs WHERE simulation_id = $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
            simulationId,
            limit,
            offset,
        )
        total = await conn.fetchval(
            "SELECT count(*)::int FROM monte_carlo_runs WHERE simulation_id = $1",
            simulationId,
        )
    return {
        "items": [monte_carlo_run_row(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /reports/{simulationId}
# ---------------------------------------------------------------------------
@router.get("/reports/{simulationId}")
async def simulation_report(simulationId: int) -> dict:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT * FROM simulations WHERE id = $1", simulationId
        )
        if not sim:
            raise HTTPException(status_code=404, detail={"error": "Simulation not found"})

        agents = await conn.fetch(
            "SELECT * FROM agents WHERE simulation_id = $1", simulationId
        )
        snapshots = await conn.fetch(
            """SELECT * FROM belief_snapshots WHERE simulation_id = $1
               ORDER BY round""",
            simulationId,
        )
        latest_mc = await conn.fetchrow(
            """SELECT * FROM monte_carlo_runs WHERE simulation_id = $1
               ORDER BY created_at DESC LIMIT 1""",
            simulationId,
        )

    def bs_policy(a) -> float:
        b = a["belief_state"]
        if isinstance(b, str):
            b = json.loads(b)
        return float(b.get("policySupport", 0))

    sorted_agents = sorted(
        agents, key=lambda a: float(a["influence_score"]), reverse=True
    )
    avg_support = (
        sum(bs_policy(a) for a in agents) / len(agents) if agents else 0.0
    )
    supportive = sum(1 for a in agents if bs_policy(a) > 0.3)
    opposed = sum(1 for a in agents if bs_policy(a) < -0.3)
    n = len(agents) or 1

    key_outcomes = [
        {
            "label": "Policy adoption likelihood",
            "probability": max(0, min(1, (avg_support + 1) / 2)),
            "impact": "high" if avg_support > 0.3 else "medium" if avg_support > 0 else "low",
        },
        {
            "label": "Public consensus reached",
            "probability": max(0, 1 - abs(supportive - opposed) / n),
            "impact": "medium",
        },
        {
            "label": "Social polarization risk",
            "probability": min(1, (supportive + opposed) / n),
            "impact": "high"
            if supportive + opposed > len(agents) * 0.7
            else "low",
        },
    ]

    risk_factors = []
    if avg_support < -0.3:
        risk_factors.append("Strong opposition to policy detected")
    if supportive + opposed > len(agents) * 0.7:
        risk_factors.append("High polarization among agents")
    if len(agents) < 5:
        risk_factors.append("Low sample size may affect prediction accuracy")
    if sim["current_round"] < 3:
        risk_factors.append("Insufficient simulation rounds for convergence")
    risk_factors.append("External events may significantly alter outcomes")

    causal_drivers = [
        "Agent influence network topology",
        "Initial belief state distribution",
        "Learning rate and signal propagation",
        "Activity level and engagement patterns",
        "Source credibility weighting",
    ]

    if latest_mc:
        mc_summary = {
            "totalRuns": latest_mc["num_runs"],
            "meanSupport": float(latest_mc["mean_support"]),
            "variance": float(latest_mc["variance"]),
            "confidenceInterval": [
                float(latest_mc["min_support"]),
                float(latest_mc["max_support"]),
            ],
        }
    else:
        mc_summary = {
            "totalRuns": 0,
            "meanSupport": avg_support,
            "variance": 0.0,
            "confidenceInterval": [avg_support, avg_support],
        }

    belief_evolution = [
        {
            "round": s["round"],
            "averagePolicySupport": float(s["average_policy_support"]),
            "averageTrustInGovernment": float(s["average_trust_in_government"]),
            "averageEconomicOutlook": float(s["average_economic_outlook"]),
        }
        for s in snapshots
    ]

    now = datetime.now(timezone.utc)

    return {
        "simulationId": sim["id"],
        "simulationName": sim["name"],
        "generatedAt": now.isoformat(),
        "keyOutcomes": key_outcomes,
        "riskFactors": risk_factors,
        "influentialAgents": [
            {
                "agentId": a["id"],
                "name": a["name"],
                "influenceScore": float(a["influence_score"]),
                "stance": a["stance"],
            }
            for a in sorted_agents[:5]
        ],
        "causalDrivers": causal_drivers,
        "monteCarloSummary": mc_summary,
        "beliefEvolution": belief_evolution,
    }


# ---------------------------------------------------------------------------
# GET /reports/{simulationId}/stream  —  SSE streaming report generation
# ---------------------------------------------------------------------------
@router.get("/reports/{simulationId}/stream")
async def simulation_report_stream(simulationId: int) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            yield _sse({"type": "status", "phase": "init", "message": "Loading simulation data..."})

            p = pool()
            async with p.acquire() as conn:
                sim = await conn.fetchrow(
                    "SELECT * FROM simulations WHERE id = $1", simulationId
                )
                if not sim:
                    yield _sse({"type": "error", "message": "Simulation not found"})
                    return

                yield _sse({"type": "status", "phase": "agents", "message": "Analyzing agent states..."})

                agents = await conn.fetch(
                    "SELECT * FROM agents WHERE simulation_id = $1", simulationId
                )

                yield _sse({
                    "type": "status",
                    "phase": "snapshots",
                    "message": f"Loading belief snapshots for {len(agents)} agents...",
                })

                snapshots = await conn.fetch(
                    """SELECT * FROM belief_snapshots WHERE simulation_id = $1
                       ORDER BY round""",
                    simulationId,
                )

                yield _sse({"type": "status", "phase": "montecarlo", "message": "Fetching Monte Carlo data..."})

                latest_mc = await conn.fetchrow(
                    """SELECT * FROM monte_carlo_runs WHERE simulation_id = $1
                       ORDER BY created_at DESC LIMIT 1""",
                    simulationId,
                )

            yield _sse({"type": "status", "phase": "computing", "message": "Computing key outcomes..."})

            def bs_policy(a) -> float:
                b = a["belief_state"]
                if isinstance(b, str):
                    b = json.loads(b)
                return float(b.get("policySupport", 0))

            sorted_agents = sorted(
                agents, key=lambda a: float(a["influence_score"]), reverse=True
            )
            avg_support = (
                sum(bs_policy(a) for a in agents) / len(agents) if agents else 0.0
            )
            supportive = sum(1 for a in agents if bs_policy(a) > 0.3)
            opposed = sum(1 for a in agents if bs_policy(a) < -0.3)
            n = len(agents) or 1

            key_outcomes = [
                {
                    "label": "Policy adoption likelihood",
                    "probability": max(0, min(1, (avg_support + 1) / 2)),
                    "impact": "high" if avg_support > 0.3 else "medium" if avg_support > 0 else "low",
                },
                {
                    "label": "Public consensus reached",
                    "probability": max(0, 1 - abs(supportive - opposed) / n),
                    "impact": "medium",
                },
                {
                    "label": "Social polarization risk",
                    "probability": min(1, (supportive + opposed) / n),
                    "impact": "high" if supportive + opposed > len(agents) * 0.7 else "low",
                },
            ]

            yield _sse({"type": "status", "phase": "risks", "message": "Evaluating risk factors..."})

            risk_factors = []
            if avg_support < -0.3:
                risk_factors.append("Strong opposition to policy detected")
            if supportive + opposed > len(agents) * 0.7:
                risk_factors.append("High polarization among agents")
            if len(agents) < 5:
                risk_factors.append("Low sample size may affect prediction accuracy")
            if sim["current_round"] < 3:
                risk_factors.append("Insufficient simulation rounds for convergence")
            risk_factors.append("External events may significantly alter outcomes")

            causal_drivers = [
                "Agent influence network topology",
                "Initial belief state distribution",
                "Learning rate and signal propagation",
                "Activity level and engagement patterns",
                "Source credibility weighting",
            ]

            yield _sse({"type": "status", "phase": "influencers", "message": "Identifying key influencers..."})

            if latest_mc:
                mc_summary = {
                    "totalRuns": latest_mc["num_runs"],
                    "meanSupport": float(latest_mc["mean_support"]),
                    "variance": float(latest_mc["variance"]),
                    "confidenceInterval": [
                        float(latest_mc["min_support"]),
                        float(latest_mc["max_support"]),
                    ],
                }
            else:
                mc_summary = {
                    "totalRuns": 0,
                    "meanSupport": avg_support,
                    "variance": 0.0,
                    "confidenceInterval": [avg_support, avg_support],
                }

            belief_evolution = [
                {
                    "round": s["round"],
                    "averagePolicySupport": float(s["average_policy_support"]),
                    "averageTrustInGovernment": float(s["average_trust_in_government"]),
                    "averageEconomicOutlook": float(s["average_economic_outlook"]),
                }
                for s in snapshots
            ]

            now = datetime.now(timezone.utc)

            yield _sse({
                "type": "complete",
                "report": {
                    "simulationId": sim["id"],
                    "simulationName": sim["name"],
                    "generatedAt": now.isoformat(),
                    "keyOutcomes": key_outcomes,
                    "riskFactors": risk_factors,
                    "influentialAgents": [
                        {
                            "agentId": a["id"],
                            "name": a["name"],
                            "influenceScore": float(a["influence_score"]),
                            "stance": a["stance"],
                        }
                        for a in sorted_agents[:5]
                    ],
                    "causalDrivers": causal_drivers,
                    "monteCarloSummary": mc_summary,
                    "beliefEvolution": belief_evolution,
                },
            })
        except Exception as exc:
            logger.exception("report-stream failed for simulation %s", simulationId)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)
