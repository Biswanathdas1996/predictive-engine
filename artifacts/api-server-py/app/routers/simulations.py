import asyncio
import json
import logging
import random
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Body, HTTPException, Query, Response

from app.db import pool
from app.serialize import (
    agent_row,
    comment_row,
    monte_carlo_run_row,
    post_row,
    simulation_row,
)
from app.services import neo4j_service
from app.services.simulation_engine import run_monte_carlo, run_simulation_round

logger = logging.getLogger(__name__)

router = APIRouter()

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


async def _sim_counts(conn, sim_id: int) -> tuple[int, int]:
    ac = await conn.fetchval(
        "SELECT count(*)::int FROM agents WHERE simulation_id = $1", sim_id
    )
    pc = await conn.fetchval(
        "SELECT count(*)::int FROM posts WHERE simulation_id = $1", sim_id
    )
    return int(ac or 0), int(pc or 0)


@router.get("/simulations")
async def list_simulations() -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM simulations ORDER BY created_at DESC"
        )
        out = []
        for r in rows:
            ta, tp = await _sim_counts(conn, r["id"])
            out.append(simulation_row(r, total_agents=ta, total_posts=tp))
    return out


def _cfg_int(cfg: dict, key: str, default: int) -> int:
    v = cfg.get(key, default)
    if v is None:
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _cfg_float(cfg: dict, key: str, default: float) -> float:
    v = cfg.get(key, default)
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@router.post("/simulations", status_code=201)
async def create_simulation(body: dict) -> dict:
    if "name" not in body or "config" not in body:
        raise HTTPException(status_code=400, detail={"error": "name and config required"})
    desc = body.get("description", "")
    cfg = body["config"]
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=400, detail={"error": "config must be an object"})
    agent_count = max(0, _cfg_int(cfg, "agentCount", 10))
    cfg = {
        **cfg,
        "agentCount": agent_count,
        "numRounds": max(1, _cfg_int(cfg, "numRounds", 10)),
        "learningRate": _cfg_float(cfg, "learningRate", 0.3),
    }
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            """INSERT INTO simulations (name, description, config)
               VALUES ($1, $2, $3::jsonb) RETURNING *""",
            body["name"],
            desc,
            json.dumps(cfg),
        )
        sim_id = sim["id"]

        agents_to_create = []
        for i in range(agent_count):
            template = PERSONAS[i % len(PERSONAS)]
            name = template["name"]
            if i >= len(PERSONAS):
                name = f"{template['name']} {i // len(PERSONAS) + 1}"
            agents_to_create.append(
                (
                    name,
                    template["age"],
                    template["gender"],
                    template["region"],
                    template["occupation"],
                    template["persona"],
                    template["stance"],
                    0.3 + random.random() * 0.5,
                    0.4 + random.random() * 0.4,
                    json.dumps(
                        {
                            "policySupport": (random.random() - 0.5) * 1.6,
                            "trustInGovernment": random.random() * 0.8 + 0.1,
                            "economicOutlook": (random.random() - 0.5) * 1.4,
                        }
                    ),
                    0.3 + random.random() * 0.5,
                    0.3 + random.random() * 0.5,
                    sim_id,
                )
            )

        for tup in agents_to_create:
            row = await conn.fetchrow(
                """INSERT INTO agents (
                name, age, gender, region, occupation, persona, stance,
                influence_score, credibility_score, belief_state, confidence_level,
                activity_level, simulation_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
                RETURNING *""",
                *tup,
            )
            out_agent = agent_row(row)
            asyncio.create_task(neo4j_service.sync_agent_to_graph(out_agent))

        created_agents = await conn.fetch(
            "SELECT * FROM agents WHERE simulation_id = $1", sim_id
        )
        agents_list = list(created_agents)
        n_agents = len(agents_list)

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
                    asyncio.create_task(
                        neo4j_service.sync_influence_to_graph(
                            ag["id"], agents_list[j]["id"], weight
                        )
                    )

        ta, _ = await _sim_counts(conn, sim_id)

    cfg_out = sim["config"]
    if isinstance(cfg_out, str):
        cfg_out = json.loads(cfg_out)
    return {
        "id": sim["id"],
        "name": sim["name"],
        "description": sim["description"],
        "status": sim["status"],
        "currentRound": sim["current_round"],
        "totalAgents": ta,
        "totalPosts": 0,
        "config": cfg_out,
        "createdAt": sim["created_at"].isoformat() if sim["created_at"] else None,
    }


@router.get("/simulations/{id}")
async def get_simulation(id: int) -> dict:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow("SELECT * FROM simulations WHERE id = $1", id)
        if not sim:
            raise HTTPException(status_code=404, detail={"error": "Simulation not found"})
        ta, tp = await _sim_counts(conn, id)
    return simulation_row(sim, total_agents=ta, total_posts=tp)


@router.delete("/simulations/{id}", status_code=204)
async def delete_simulation(id: int) -> Response:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow("SELECT id FROM simulations WHERE id = $1", id)
        if not sim:
            raise HTTPException(status_code=404, detail={"error": "Simulation not found"})

        await conn.execute("DELETE FROM comments WHERE simulation_id = $1", id)
        await conn.execute("DELETE FROM posts WHERE simulation_id = $1", id)
        await conn.execute("DELETE FROM belief_snapshots WHERE simulation_id = $1", id)
        await conn.execute("DELETE FROM monte_carlo_runs WHERE simulation_id = $1", id)

        agents = await conn.fetch(
            "SELECT id FROM agents WHERE simulation_id = $1", id
        )
        for a in agents:
            await conn.execute(
                "DELETE FROM influences WHERE source_agent_id = $1 OR target_agent_id = $1",
                a["id"],
            )
        await conn.execute("DELETE FROM agents WHERE simulation_id = $1", id)
        await conn.execute("DELETE FROM simulations WHERE id = $1", id)

    return Response(status_code=204)


@router.post("/simulations/{id}/run")
async def run_round(id: int) -> dict:
    try:
        return await run_simulation_round(id)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail={"error": msg}) from e
        raise HTTPException(status_code=400, detail={"error": msg}) from e


@router.get("/simulations/{id}/posts")
async def get_simulation_posts(
    id: int, limit: int = Query(50)
) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        posts = await conn.fetch(
            """SELECT * FROM posts WHERE simulation_id = $1
               ORDER BY created_at DESC LIMIT $2""",
            id,
            limit,
        )
        agents = await conn.fetch(
            "SELECT id, name FROM agents WHERE simulation_id = $1", id
        )
    amap = {a["id"]: a["name"] for a in agents}
    return [post_row(pr, agent_name=amap.get(pr["agent_id"], "Unknown")) for pr in posts]


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
        bs = a["belief_state"]
        if isinstance(bs, str):
            bs = json.loads(bs)
        nodes.append(
            {
                "id": a["id"],
                "name": a["name"],
                "stance": a["stance"],
                "influenceScore": float(a["influence_score"]),
                "policySupport": float(bs.get("policySupport", 0)),
                "confidenceLevel": float(a["confidence_level"]),
            }
        )

    edges = [
        {
            "source": inf["source_agent_id"],
            "target": inf["target_agent_id"],
            "weight": float(inf["weight"]),
        }
        for inf in influences
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


@router.post("/montecarlo/{simulationId}")
async def montecarlo_run(
    simulationId: int, body: dict = Body(default_factory=dict)
) -> dict:
    num_runs = int(body.get("numRuns", 50))
    rounds_per_run = int(body.get("roundsPerRun", 5))
    try:
        result = await run_monte_carlo(simulationId, num_runs, rounds_per_run)
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)}) from e

    p = pool()
    async with p.acquire() as conn:
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


@router.get("/montecarlo/{simulationId}/runs")
async def montecarlo_runs(simulationId: int) -> list[dict]:
    p = pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM monte_carlo_runs WHERE simulation_id = $1
               ORDER BY created_at DESC""",
            simulationId,
        )
    return [monte_carlo_run_row(r) for r in rows]


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
