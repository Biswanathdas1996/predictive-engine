"""Simulation engine — belief propagation, agent content generation, Monte Carlo.

Enterprise improvements over the original:
- Advisory lock prevents concurrent runs on the same simulation
- Full transaction wrapping (all-or-nothing round execution)
- Round content generation uses PwC GenAI only (no deterministic fallback)
- LLM generation phase separated from DB connection hold
- Belief snapshot computed from *updated* agent states (fixes stale-data bug)
- Monte Carlo offloaded to thread pool for CPU-bound work
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator
from typing import Any, Literal, NotRequired, TypedDict, cast

import asyncpg

from app import config
from app.db import pool
from app.services import llm_service
from app.services import neo4j_service
from app.services.prompt_templates import (
    build_agent_action_prompt,
    build_agent_reaction_prompt,
    build_graph_context_summary,
)

logger = logging.getLogger(__name__)


class BeliefState(TypedDict):
    policySupport: float
    trustInGovernment: float
    economicOutlook: float


class AgentRow(TypedDict):
    id: int
    name: str
    age: int
    gender: str
    region: str
    occupation: str
    beliefState: BeliefState
    confidenceLevel: float
    influenceScore: float
    credibilityScore: float
    activityLevel: float
    stance: str
    persona: str
    systemPrompt: NotRequired[str | None]


def clamp(value: float, min_v: float, max_v: float) -> float:
    return max(min_v, min(max_v, value))


def update_belief(
    agent: dict[str, Any],
    incoming_signal: float,
    influence_weight: float,
    learning_rate: float = 0.3,
) -> dict[str, Any]:
    bs = agent["beliefState"]
    delta = (
        learning_rate
        * influence_weight
        * (incoming_signal - bs["policySupport"])
    )
    new_policy = clamp(bs["policySupport"] + delta, -1, 1)
    new_confidence = clamp(agent["confidenceLevel"] + abs(delta) * 0.1, 0, 1)
    trust_delta = (
        learning_rate * influence_weight * 0.3 * (0.1 if incoming_signal > 0 else -0.1)
    )
    new_trust = clamp(bs["trustInGovernment"] + trust_delta, -1, 1)
    econ_delta = learning_rate * influence_weight * 0.2 * incoming_signal
    new_econ = clamp(bs["economicOutlook"] + econ_delta, -1, 1)
    return {
        "beliefState": {
            "policySupport": new_policy,
            "trustInGovernment": new_trust,
            "economicOutlook": new_econ,
        },
        "confidenceLevel": new_confidence,
    }


STANCE_TEXTS: dict[str, list[str]] = {
    "supportive": [
        "This policy direction shows real promise. We need more initiatives like this.",
        "I believe the current approach is heading in the right direction for our community.",
        "The data supports what we've been saying - this policy works.",
        "As someone in the field, I can confirm the positive impact of these measures.",
    ],
    "opposed": [
        "We need to seriously reconsider this approach. The evidence doesn't support it.",
        "From my experience, this policy is creating more problems than it solves.",
        "The costs outweigh the benefits here. We need alternatives.",
        "I'm concerned about the long-term consequences of this direction.",
    ],
    "neutral": [
        "There are valid points on both sides of this discussion.",
        "I think we need more data before drawing conclusions.",
        "The situation is more nuanced than most people realize.",
        "I'm still evaluating the evidence on this policy.",
    ],
    "radical": [
        "The entire system needs fundamental restructuring, not half-measures.",
        "We cannot keep applying band-aid solutions to systemic problems.",
        "Bold action is required - incremental change won't cut it anymore.",
        "The status quo is unsustainable. We need revolutionary thinking.",
    ],
}

REACTION_TEXTS: dict[str, list[str]] = {
    "agree": [
        "Exactly! This is what I've been saying.",
        "Couldn't agree more. Well said.",
        "This matches what I've seen too.",
        "Yes, finally someone gets it.",
    ],
    "disagree": [
        "I have to respectfully disagree here.",
        "That's not what the evidence shows.",
        "I think you're missing the bigger picture.",
        "Hard disagree. Let me explain why...",
    ],
    "neutral": [
        "Interesting perspective, but I'm not sure yet.",
        "I can see where you're coming from.",
        "Worth considering, though I have reservations.",
        "Fair point, but there's more to it.",
    ],
}


def generate_deterministic_action(
    agent: AgentRow, round_num: int
) -> tuple[Literal["post", "comment", "ignore"], str, float]:
    # Higher activityLevel ⇒ lower chance to skip. Baseline keeps most agents
    # posting at least sometimes (pure 1-activity was harsh when activity≈0.3).
    participate_threshold = 0.5 + 0.5 * float(agent["activityLevel"])
    if random.random() > participate_threshold:
        return "ignore", "", 0.0
    bs = agent["beliefState"]
    sentiment = clamp(
        bs["policySupport"] * 0.6
        + bs["economicOutlook"] * 0.2
        + (random.random() - 0.5) * 0.4,
        -1,
        1,
    )
    texts = STANCE_TEXTS.get(agent["stance"], STANCE_TEXTS["neutral"])
    content = random.choice(texts)
    action: Literal["post", "comment"] = (
        "post" if random.random() > 0.3 else "comment"
    )
    return action, f"[{agent['name']}, Round {round_num}] {content}", sentiment


def generate_deterministic_reaction(
    agent: AgentRow, _post_content: str, post_sentiment: float, round_num: int
) -> tuple[str, float]:
    bs = agent["beliefState"]
    alignment = bs["policySupport"] * post_sentiment
    if alignment > 0.2:
        reaction_type = "agree"
    elif alignment < -0.2:
        reaction_type = "disagree"
    else:
        reaction_type = "neutral"
    texts = REACTION_TEXTS[reaction_type]
    content = random.choice(texts)
    sentiment = clamp(bs["policySupport"] * 0.5 + (random.random() - 0.5) * 0.3, -1, 1)
    return f"[{agent['name']}, Round {round_num}] {content}", sentiment


def _to_agent_row(agent: asyncpg.Record) -> AgentRow:
    bs = agent["belief_state"]
    if isinstance(bs, str):
        bs = json.loads(bs)
    sp_raw = agent.get("system_prompt")
    sp: str | None
    if isinstance(sp_raw, str) and sp_raw.strip():
        sp = sp_raw.strip()
    else:
        sp = None
    row = AgentRow(
        id=agent["id"],
        name=agent["name"],
        age=agent["age"],
        gender=agent["gender"],
        region=agent["region"],
        occupation=agent["occupation"],
        beliefState=bs,  # type: ignore[arg-type]
        confidenceLevel=float(agent["confidence_level"]),
        influenceScore=float(agent["influence_score"]),
        credibilityScore=float(agent["credibility_score"]),
        activityLevel=float(agent["activity_level"]),
        stance=agent["stance"],
        persona=agent["persona"],
    )
    if sp:
        row["systemPrompt"] = sp
    return row


def _persona_dict_for_prompt(ar: AgentRow) -> dict[str, Any]:
    d: dict[str, Any] = {
        "name": ar["name"],
        "age": ar["age"],
        "gender": ar["gender"],
        "region": ar["region"],
        "occupation": ar["occupation"],
        "persona": ar["persona"],
        "stance": ar["stance"],
    }
    if ar.get("systemPrompt"):
        d["systemPrompt"] = ar["systemPrompt"]
    return d


async def generate_llm_action(
    agent: AgentRow,
    round_num: int,
    recent_posts: list[dict[str, Any]],
    neighbors: list[dict[str, str]],
    event: str | None = None,
    policy_brief: str | None = None,
    llm_only: bool = False,
) -> tuple[Literal["post", "comment", "ignore"], str, float]:
    graph_summary = build_graph_context_summary(neighbors, recent_posts)
    ctx: dict[str, Any] = {
        "persona": _persona_dict_for_prompt(agent),
        "beliefState": agent["beliefState"],
        "confidenceLevel": agent["confidenceLevel"],
        "graphContextSummary": graph_summary,
    }
    if event:
        ctx["event"] = event
    if policy_brief:
        ctx["policyBrief"] = policy_brief
    prompt = build_agent_action_prompt(ctx)
    result = await llm_service.generate_agent_action(prompt)
    if result and result.get("action"):
        act = result["action"]
        if act not in ("post", "comment", "ignore"):
            act = "post"
        return (
            cast(Literal["post", "comment", "ignore"], act),
            str(result.get("content") or ""),
            float(result.get("sentiment", 0)),
        )
    if llm_only:
        raise ValueError(
            f"LLM returned no valid JSON action for agent {agent['name']!r}. "
            "Retry the round or check GenAI logs."
        )
    a, c, s = generate_deterministic_action(agent, round_num)
    return a, c, s


async def _reaction_content_and_sentiment(
    use_llm: bool,
    ar: AgentRow,
    target_post: dict[str, Any],
    new_round: int,
    rprompt: str | None,
    llm_only: bool = False,
) -> tuple[str, float]:
    if use_llm and rprompt:
        result = await llm_service.generate_agent_action(rprompt)
        if result and result.get("content"):
            return str(result["content"]), float(result.get("sentiment", 0))
        if llm_only:
            raise ValueError(
                f"LLM returned no valid JSON reaction for agent {ar['name']!r}."
            )
        return generate_deterministic_reaction(
            ar,
            target_post["content"],
            float(target_post["sentiment"]),
            new_round,
        )
    if llm_only:
        raise ValueError("Policy-linked simulation requires LLM for agent reactions.")
    return generate_deterministic_reaction(
        ar,
        target_post["content"],
        float(target_post["sentiment"]),
        new_round,
    )


# ---------------------------------------------------------------------------
# Advisory lock key derivation — uses simulation_id to prevent concurrent
# runs on the same simulation while allowing different simulations in parallel.
# ---------------------------------------------------------------------------
_ADVISORY_LOCK_NAMESPACE = 839201  # arbitrary constant


def _config_policy_id(cfg: dict[str, Any]) -> int | None:
    raw = cfg.get("policyId")
    if raw is None or raw == "":
        return None
    try:
        pid = int(raw)
    except (TypeError, ValueError):
        return None
    return pid if pid > 0 else None


async def run_simulation_round(simulation_id: int) -> dict[str, Any]:
    p = pool()
    async with p.acquire() as conn:
        # ── Phase 1: Read + lock (short DB hold) ──────────────────────────
        # Try advisory lock — fails immediately if another round is running
        locked = await conn.fetchval(
            "SELECT pg_try_advisory_lock($1, $2)",
            _ADVISORY_LOCK_NAMESPACE,
            simulation_id,
        )
        if not locked:
            raise ValueError(
                "Another round is already running for this simulation. "
                "Wait for it to complete before starting a new one."
            )

        try:
            sim = await conn.fetchrow(
                "SELECT * FROM simulations WHERE id = $1", simulation_id
            )
            if not sim:
                raise ValueError("Simulation not found")

            # Determine whether to read the influence graph from Neo4j
            _use_neo4j_graph = (
                config.GRAPH_BACKEND == "neo4j" and neo4j_service.is_neo4j_available()
            )

            if _use_neo4j_graph:
                logger.info(
                    "GRAPH_BACKEND=neo4j — reading agents & influences from Neo4j "
                    "for simulation %s",
                    simulation_id,
                )
                neo4j_agents = await neo4j_service.read_agents_from_graph(simulation_id)
                if not neo4j_agents:
                    logger.warning(
                        "Neo4j returned no agents for simulation %s — "
                        "falling back to PostgreSQL",
                        simulation_id,
                    )
                    _use_neo4j_graph = False

            if _use_neo4j_graph:
                # Build asyncpg-Record-compatible dicts so downstream code works unchanged
                agents = neo4j_agents  # type: ignore[assignment]
                agent_ids = [a["id"] for a in agents]
                influences = await neo4j_service.read_influences_from_graph(agent_ids)
            else:
                agents = await conn.fetch(
                    "SELECT * FROM agents WHERE simulation_id = $1", simulation_id
                )
                if not agents:
                    raise ValueError("No agents in this simulation")

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

            new_round = sim["current_round"] + 1
            cfg = sim["config"]
            if isinstance(cfg, str):
                cfg = json.loads(cfg)
            learning_rate = float(cfg.get("learningRate", 0.3))

            if not llm_service.is_llm_available():
                raise ValueError(
                    "Simulation rounds require PwC GenAI. "
                    "Set PWC_GENAI_API_KEY or PWC_GENAI_BEARER_TOKEN."
                )

            policy_id = _config_policy_id(cfg)
            policy_brief: str | None = None
            policy_linked = False
            if policy_id is not None:
                prow = await conn.fetchrow(
                    "SELECT title, summary FROM policies WHERE id = $1",
                    policy_id,
                )
                if not prow:
                    raise ValueError(f"Policy {policy_id} was not found.")
                try:
                    policy_brief = await llm_service.policy_key_points_brief(
                        str(prow["title"] or ""),
                        str(prow["summary"] or ""),
                    )
                except Exception as exc:
                    detail = f" {exc}" if str(exc) else ""
                    raise ValueError(
                        "Could not build a compact policy summary for agents. "
                        "Check GenAI connectivity, PWC_GENAI_MODEL, and policy text, then try again."
                        + detail
                    ) from exc
                policy_linked = True

            recent_posts: list[dict[str, Any]] = []
            posts = await conn.fetch(
                """SELECT * FROM posts WHERE simulation_id = $1
                   ORDER BY created_at DESC LIMIT 10""",
                simulation_id,
            )
            agent_map = {a["id"]: a["name"] for a in agents}
            for p_row in reversed(list(posts)):
                recent_posts.append(
                    {
                        "agentName": agent_map.get(p_row["agent_id"], "Unknown"),
                        "content": p_row["content"],
                        "sentiment": float(p_row["sentiment"]),
                    }
                )

            # ── Phase 2: Belief propagation + LLM generation (no DB needed) ──
            agents_by_id = {a["id"]: a for a in agents}
            agent_rows: dict[int, AgentRow] = {}
            for agent in agents:
                agent_rows[agent["id"]] = _to_agent_row(agent)

            # Belief propagation (in-memory)
            beliefs_updated = 0
            for agent in agents:
                ar = agent_rows[agent["id"]]
                incoming = [i for i in influences if i["target_agent_id"] == agent["id"]]
                for inf in incoming:
                    source = agents_by_id.get(inf["source_agent_id"])
                    if source:
                        source_bs = source["belief_state"]
                        if isinstance(source_bs, str):
                            source_bs = json.loads(source_bs)
                        upd = update_belief(
                            {
                                "beliefState": ar["beliefState"],
                                "confidenceLevel": ar["confidenceLevel"],
                            },
                            float(source_bs["policySupport"]),
                            float(inf["weight"]) * float(source["credibility_score"]),
                            learning_rate,
                        )
                        ar["beliefState"] = upd["beliefState"]  # type: ignore[assignment]
                        ar["confidenceLevel"] = upd["confidenceLevel"]
                        beliefs_updated += 1

            # Content generation (LLM only — parallel, no DB connection held)
            async def _gen_action(agent: Any) -> dict[str, Any]:
                ar = agent_rows[agent["id"]]
                incoming = [i for i in influences if i["target_agent_id"] == agent["id"]]
                neighbor_list = []
                for inf in incoming:
                    src = agents_by_id.get(inf["source_agent_id"])
                    if src:
                        neighbor_list.append({"name": src["name"], "stance": src["stance"]})
                action, content, sentiment = await generate_llm_action(
                    ar,
                    new_round,
                    recent_posts,
                    neighbor_list,
                    policy_brief=policy_brief,
                    llm_only=True,
                )
                return {
                    "agentId": agent["id"],
                    "name": agent["name"],
                    "action": action,
                    "content": content,
                    "sentiment": sentiment,
                    "agentRow": ar,
                }

            agent_actions = await asyncio.gather(*[_gen_action(a) for a in agents])

            # ── Phase 3: Write everything in a single transaction ─────────
            round_posts: list[dict[str, Any]] = []
            total_sentiment = 0.0
            total_policy_support = 0.0
            posts_generated = 0
            agent_states: list[dict[str, Any]] = []

            async with conn.transaction():
                for aa in agent_actions:
                    ar = aa["agentRow"]
                    action = aa["action"]
                    content = aa["content"]
                    sentiment = aa["sentiment"]

                    tags: list[str] = []
                    if action != "ignore" and content:
                        if sentiment > 0.3:
                            tags.append("positive")
                        if sentiment < -0.3:
                            tags.append("negative")
                        tags.append("policy-discussion")

                        if action == "post":
                            post = await conn.fetchrow(
                                """INSERT INTO posts
                                (content, sentiment, platform, topic_tags, round, agent_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                RETURNING *""",
                                content, sentiment, "simulation", tags,
                                new_round, aa["agentId"], simulation_id,
                            )
                            round_posts.append({
                                "id": post["id"],
                                "content": content,
                                "sentiment": sentiment,
                                "agentId": aa["agentId"],
                            })
                            posts_generated += 1
                        elif action == "comment" and round_posts:
                            target = random.choice(round_posts)
                            await conn.fetchrow(
                                """INSERT INTO comments
                                (content, sentiment, round, agent_id, post_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6)
                                RETURNING *""",
                                content, sentiment, new_round,
                                aa["agentId"], target["id"], simulation_id,
                            )
                            posts_generated += 1
                        else:
                            # Wanted to comment but no posts yet — create as post
                            post = await conn.fetchrow(
                                """INSERT INTO posts
                                (content, sentiment, platform, topic_tags, round, agent_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                RETURNING *""",
                                content, sentiment, "simulation", tags,
                                new_round, aa["agentId"], simulation_id,
                            )
                            round_posts.append({
                                "id": post["id"],
                                "content": content,
                                "sentiment": sentiment,
                                "agentId": aa["agentId"],
                            })
                            posts_generated += 1

                    # Update agent belief state
                    await conn.execute(
                        """UPDATE agents SET belief_state = $1::jsonb, confidence_level = $2
                           WHERE id = $3""",
                        json.dumps(ar["beliefState"]),
                        ar["confidenceLevel"],
                        aa["agentId"],
                    )

                    total_sentiment += sentiment
                    total_policy_support += ar["beliefState"]["policySupport"]

                    agent_states.append({
                        "agentId": aa["agentId"],
                        "name": aa["name"],
                        "policySupport": ar["beliefState"]["policySupport"],
                        "confidenceLevel": ar["confidenceLevel"],
                        "action": action,
                        "sentiment": sentiment,
                    })

                # Handle reactions from ignored agents (LLM calls in parallel)
                ignored = [s for s in agent_states if s["action"] == "ignore"]
                reaction_jobs: list[dict[str, Any]] = []
                for ignored_state in ignored[:3]:
                    if not round_posts:
                        break
                    if random.random() > 0.3:
                        continue
                    reacting = agents_by_id.get(ignored_state["agentId"])
                    if not reacting:
                        continue
                    ar = agent_rows[reacting["id"]]
                    target_post = random.choice(round_posts)
                    rp_ctx: dict[str, Any] = {
                        "postContent": target_post["content"],
                        "persona": _persona_dict_for_prompt(ar),
                        "beliefState": ar["beliefState"],
                    }
                    if policy_brief:
                        rp_ctx["policyBrief"] = policy_brief
                    rprompt = build_agent_reaction_prompt(rp_ctx)
                    reaction_jobs.append({
                        "reacting_id": reacting["id"],
                        "target_post": target_post,
                        "ar": ar,
                        "rprompt": rprompt,
                    })

                reaction_pairs = await asyncio.gather(
                    *[
                        _reaction_content_and_sentiment(
                            True,
                            j["ar"],
                            j["target_post"],
                            new_round,
                            j["rprompt"],
                            llm_only=True,
                        )
                        for j in reaction_jobs
                    ]
                )
                for j, (reaction_content, reaction_sentiment) in zip(
                    reaction_jobs, reaction_pairs, strict=True
                ):
                    await conn.fetchrow(
                        """INSERT INTO comments
                        (content, sentiment, round, agent_id, post_id, simulation_id)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        RETURNING *""",
                        reaction_content,
                        reaction_sentiment,
                        new_round,
                        j["reacting_id"],
                        j["target_post"]["id"],
                        simulation_id,
                    )

                # FIX: Belief snapshot now uses UPDATED agent states, not stale originals
                n_agents = len(agents)
                avg_trust = sum(
                    agent_rows[a["id"]]["beliefState"]["trustInGovernment"]
                    for a in agents
                ) / n_agents
                avg_econ = sum(
                    agent_rows[a["id"]]["beliefState"]["economicOutlook"]
                    for a in agents
                ) / n_agents

                await conn.execute(
                    """INSERT INTO belief_snapshots
                    (simulation_id, round, average_policy_support, average_trust_in_government, average_economic_outlook)
                    VALUES ($1, $2, $3, $4, $5)""",
                    simulation_id,
                    new_round,
                    total_policy_support / n_agents,
                    avg_trust,
                    avg_econ,
                )

                await conn.execute(
                    """UPDATE simulations SET current_round = $1, status = $2 WHERE id = $3""",
                    new_round, "running", simulation_id,
                )

        finally:
            # Always release the advisory lock
            await conn.execute(
                "SELECT pg_advisory_unlock($1, $2)",
                _ADVISORY_LOCK_NAMESPACE,
                simulation_id,
            )

    # Neo4j sync (fire-and-forget, outside transaction)
    for aa in agent_actions:
        ar = aa["agentRow"]
        if neo4j_service.is_neo4j_available():
            try:
                ag_dict: dict[str, Any] = dict(ar)
                ag_dict["id"] = aa["agentId"]
                ag_dict["simulation_id"] = simulation_id
                asyncio.create_task(neo4j_service.sync_agent_to_graph(ag_dict))
            except Exception as err:
                logger.warning("Failed to sync agent to Neo4j: %s", err)

    return {
        "round": new_round,
        "postsGenerated": posts_generated,
        "beliefsUpdated": beliefs_updated,
        "averageSentiment": total_sentiment / len(agents),
        "averagePolicySupport": total_policy_support / len(agents),
        "agentStates": agent_states,
    }


# ---------------------------------------------------------------------------
# Streaming variant — yields SSE-style dicts for each phase / agent action
# ---------------------------------------------------------------------------

async def run_simulation_round_stream(
    simulation_id: int,
) -> AsyncIterator[dict[str, Any]]:
    """Same logic as run_simulation_round but yields progress events."""
    p = pool()
    async with p.acquire() as conn:
        locked = await conn.fetchval(
            "SELECT pg_try_advisory_lock($1, $2)",
            _ADVISORY_LOCK_NAMESPACE,
            simulation_id,
        )
        if not locked:
            yield {"type": "error", "message": "Another round is already running for this simulation."}
            return

        try:
            sim = await conn.fetchrow(
                "SELECT * FROM simulations WHERE id = $1", simulation_id
            )
            if not sim:
                yield {"type": "error", "message": "Simulation not found"}
                return

            yield {"type": "status", "phase": "init", "message": "Loading simulation data..."}

            _use_neo4j_graph = (
                config.GRAPH_BACKEND == "neo4j" and neo4j_service.is_neo4j_available()
            )
            if _use_neo4j_graph:
                neo4j_agents = await neo4j_service.read_agents_from_graph(simulation_id)
                if not neo4j_agents:
                    _use_neo4j_graph = False

            if _use_neo4j_graph:
                agents = neo4j_agents  # type: ignore[assignment]
                agent_ids = [a["id"] for a in agents]
                influences = await neo4j_service.read_influences_from_graph(agent_ids)
            else:
                agents = await conn.fetch(
                    "SELECT * FROM agents WHERE simulation_id = $1", simulation_id
                )
                if not agents:
                    yield {"type": "error", "message": "No agents in this simulation"}
                    return
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

            new_round = sim["current_round"] + 1
            cfg = sim["config"]
            if isinstance(cfg, str):
                cfg = json.loads(cfg)
            learning_rate = float(cfg.get("learningRate", 0.3))
            if not llm_service.is_llm_available():
                yield {
                    "type": "error",
                    "message": (
                        "Simulation rounds require PwC GenAI. "
                        "Set PWC_GENAI_API_KEY or PWC_GENAI_BEARER_TOKEN."
                    ),
                }
                return

            policy_id = _config_policy_id(cfg)
            policy_brief: str | None = None
            policy_linked = False
            if policy_id is not None:
                prow = await conn.fetchrow(
                    "SELECT title, summary FROM policies WHERE id = $1",
                    policy_id,
                )
                if not prow:
                    yield {
                        "type": "error",
                        "message": f"Policy {policy_id} was not found.",
                    }
                    return
                yield {
                    "type": "status",
                    "phase": "policy_brief",
                    "message": "Building compact policy summary for agents…",
                }
                try:
                    policy_brief = await llm_service.policy_key_points_brief(
                        str(prow["title"] or ""),
                        str(prow["summary"] or ""),
                    )
                except Exception as exc:
                    yield {
                        "type": "error",
                        "message": (
                            "Could not build a compact policy summary for agents. "
                            "Check GenAI connectivity, PWC_GENAI_MODEL, and policy text, then try again. "
                            f"({exc})"
                        ),
                    }
                    return
                policy_linked = True

            n_agents = len(agents)
            yield {
                "type": "status",
                "phase": "loaded",
                "message": f"Loaded {n_agents} agents, {len(influences)} influence edges",
                "totalAgents": n_agents,
                "round": new_round,
            }

            recent_posts: list[dict[str, Any]] = []
            posts = await conn.fetch(
                """SELECT * FROM posts WHERE simulation_id = $1
                   ORDER BY created_at DESC LIMIT 10""",
                simulation_id,
            )
            agent_map = {a["id"]: a["name"] for a in agents}
            for p_row in reversed(list(posts)):
                recent_posts.append({
                    "agentName": agent_map.get(p_row["agent_id"], "Unknown"),
                    "content": p_row["content"],
                    "sentiment": float(p_row["sentiment"]),
                })

            # Belief propagation
            yield {"type": "status", "phase": "beliefs", "message": "Propagating beliefs through influence network..."}
            agents_by_id = {a["id"]: a for a in agents}
            agent_rows: dict[int, AgentRow] = {}
            for agent in agents:
                agent_rows[agent["id"]] = _to_agent_row(agent)

            beliefs_updated = 0
            for idx, agent in enumerate(agents):
                ar = agent_rows[agent["id"]]
                incoming = [i for i in influences if i["target_agent_id"] == agent["id"]]
                for inf in incoming:
                    source = agents_by_id.get(inf["source_agent_id"])
                    if source:
                        source_bs = source["belief_state"]
                        if isinstance(source_bs, str):
                            source_bs = json.loads(source_bs)
                        upd = update_belief(
                            {
                                "beliefState": ar["beliefState"],
                                "confidenceLevel": ar["confidenceLevel"],
                            },
                            float(source_bs["policySupport"]),
                            float(inf["weight"]) * float(source["credibility_score"]),
                            learning_rate,
                        )
                        ar["beliefState"] = upd["beliefState"]  # type: ignore[assignment]
                        ar["confidenceLevel"] = upd["confidenceLevel"]
                        beliefs_updated += 1

                if (idx + 1) % max(1, n_agents // 5) == 0 or idx == n_agents - 1:
                    yield {
                        "type": "status",
                        "phase": "beliefs",
                        "message": f"Belief propagation: {idx + 1}/{n_agents} agents",
                        "current": idx + 1,
                        "total": n_agents,
                    }

            # Content generation (LLM only, same order as agents)
            yield {
                "type": "status",
                "phase": "generation",
                "message": "Generating agent content...",
                "useLLM": True,
                "policyLinked": policy_linked,
            }

            async def _stream_gen_one(agent: Any) -> dict[str, Any]:
                ar = agent_rows[agent["id"]]
                incoming = [
                    i for i in influences if i["target_agent_id"] == agent["id"]
                ]
                neighbor_list = []
                for inf in incoming:
                    src = agents_by_id.get(inf["source_agent_id"])
                    if src:
                        neighbor_list.append(
                            {"name": src["name"], "stance": src["stance"]}
                        )
                action, content, sentiment = await generate_llm_action(
                    ar,
                    new_round,
                    recent_posts,
                    neighbor_list,
                    policy_brief=policy_brief,
                    llm_only=True,
                )
                return {
                    "agentId": agent["id"],
                    "name": agent["name"],
                    "action": action,
                    "content": content,
                    "sentiment": sentiment,
                    "agentRow": ar,
                }

            agent_actions = await asyncio.gather(*[_stream_gen_one(a) for a in agents])
            for idx, (agent, aa) in enumerate(zip(agents, agent_actions, strict=True)):
                yield {
                    "type": "agent_action",
                    "phase": "generation",
                    "agentId": agent["id"],
                    "agentName": agent["name"],
                    "action": aa["action"],
                    "sentiment": aa["sentiment"],
                    "content": (aa["content"] or "")[:200],
                    "current": idx + 1,
                    "total": n_agents,
                }

            # Write phase
            yield {"type": "status", "phase": "writing", "message": "Persisting results to database..."}

            round_posts: list[dict[str, Any]] = []
            total_sentiment = 0.0
            total_policy_support = 0.0
            posts_generated = 0
            agent_states: list[dict[str, Any]] = []

            async with conn.transaction():
                for aa in agent_actions:
                    ar = aa["agentRow"]
                    action = aa["action"]
                    content = aa["content"]
                    sentiment = aa["sentiment"]

                    tags: list[str] = []
                    if action != "ignore" and content:
                        if sentiment > 0.3:
                            tags.append("positive")
                        if sentiment < -0.3:
                            tags.append("negative")
                        tags.append("policy-discussion")

                        if action == "post":
                            post = await conn.fetchrow(
                                """INSERT INTO posts
                                (content, sentiment, platform, topic_tags, round, agent_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                RETURNING *""",
                                content, sentiment, "simulation", tags,
                                new_round, aa["agentId"], simulation_id,
                            )
                            round_posts.append({
                                "id": post["id"],
                                "content": content,
                                "sentiment": sentiment,
                                "agentId": aa["agentId"],
                            })
                            posts_generated += 1
                        elif action == "comment" and round_posts:
                            target = random.choice(round_posts)
                            await conn.fetchrow(
                                """INSERT INTO comments
                                (content, sentiment, round, agent_id, post_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6)
                                RETURNING *""",
                                content, sentiment, new_round,
                                aa["agentId"], target["id"], simulation_id,
                            )
                            posts_generated += 1
                        else:
                            post = await conn.fetchrow(
                                """INSERT INTO posts
                                (content, sentiment, platform, topic_tags, round, agent_id, simulation_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                RETURNING *""",
                                content, sentiment, "simulation", tags,
                                new_round, aa["agentId"], simulation_id,
                            )
                            round_posts.append({
                                "id": post["id"],
                                "content": content,
                                "sentiment": sentiment,
                                "agentId": aa["agentId"],
                            })
                            posts_generated += 1

                    await conn.execute(
                        """UPDATE agents SET belief_state = $1::jsonb, confidence_level = $2
                           WHERE id = $3""",
                        json.dumps(ar["beliefState"]),
                        ar["confidenceLevel"],
                        aa["agentId"],
                    )

                    total_sentiment += sentiment
                    total_policy_support += ar["beliefState"]["policySupport"]

                    agent_states.append({
                        "agentId": aa["agentId"],
                        "name": aa["name"],
                        "policySupport": ar["beliefState"]["policySupport"],
                        "confidenceLevel": ar["confidenceLevel"],
                        "action": action,
                        "sentiment": sentiment,
                    })

                # Reactions from ignored agents (LLM calls in parallel)
                ignored = [s for s in agent_states if s["action"] == "ignore"]
                reaction_jobs_stream: list[dict[str, Any]] = []
                for ignored_state in ignored[:3]:
                    if not round_posts:
                        break
                    if random.random() > 0.3:
                        continue
                    reacting = agents_by_id.get(ignored_state["agentId"])
                    if not reacting:
                        continue
                    ar = agent_rows[reacting["id"]]
                    target_post = random.choice(round_posts)
                    rp_ctx_s: dict[str, Any] = {
                        "postContent": target_post["content"],
                        "persona": _persona_dict_for_prompt(ar),
                        "beliefState": ar["beliefState"],
                    }
                    if policy_brief:
                        rp_ctx_s["policyBrief"] = policy_brief
                    rprompt_s = build_agent_reaction_prompt(rp_ctx_s)
                    reaction_jobs_stream.append({
                        "reacting_id": reacting["id"],
                        "target_post": target_post,
                        "ar": ar,
                        "rprompt": rprompt_s,
                    })

                reaction_pairs_s = await asyncio.gather(
                    *[
                        _reaction_content_and_sentiment(
                            True,
                            j["ar"],
                            j["target_post"],
                            new_round,
                            j["rprompt"],
                            llm_only=True,
                        )
                        for j in reaction_jobs_stream
                    ]
                )
                for j, (reaction_content, reaction_sentiment) in zip(
                    reaction_jobs_stream, reaction_pairs_s, strict=True
                ):
                    await conn.fetchrow(
                        """INSERT INTO comments
                        (content, sentiment, round, agent_id, post_id, simulation_id)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        RETURNING *""",
                        reaction_content,
                        reaction_sentiment,
                        new_round,
                        j["reacting_id"],
                        j["target_post"]["id"],
                        simulation_id,
                    )

                avg_trust = sum(
                    agent_rows[a["id"]]["beliefState"]["trustInGovernment"]
                    for a in agents
                ) / n_agents
                avg_econ = sum(
                    agent_rows[a["id"]]["beliefState"]["economicOutlook"]
                    for a in agents
                ) / n_agents

                await conn.execute(
                    """INSERT INTO belief_snapshots
                    (simulation_id, round, average_policy_support, average_trust_in_government, average_economic_outlook)
                    VALUES ($1, $2, $3, $4, $5)""",
                    simulation_id,
                    new_round,
                    total_policy_support / n_agents,
                    avg_trust,
                    avg_econ,
                )

                await conn.execute(
                    """UPDATE simulations SET current_round = $1, status = $2 WHERE id = $3""",
                    new_round, "running", simulation_id,
                )

        finally:
            await conn.execute(
                "SELECT pg_advisory_unlock($1, $2)",
                _ADVISORY_LOCK_NAMESPACE,
                simulation_id,
            )

    # Neo4j sync
    for aa in agent_actions:
        ar = aa["agentRow"]
        if neo4j_service.is_neo4j_available():
            try:
                ag_dict: dict[str, Any] = dict(ar)
                ag_dict["id"] = aa["agentId"]
                ag_dict["simulation_id"] = simulation_id
                asyncio.create_task(neo4j_service.sync_agent_to_graph(ag_dict))
            except Exception as err:
                logger.warning("Failed to sync agent to Neo4j: %s", err)

    yield {
        "type": "complete",
        "result": {
            "round": new_round,
            "postsGenerated": posts_generated,
            "beliefsUpdated": beliefs_updated,
            "averageSentiment": total_sentiment / n_agents,
            "averagePolicySupport": total_policy_support / n_agents,
            "agentStates": agent_states,
        },
    }


# ---------------------------------------------------------------------------
# Monte Carlo — CPU-bound work offloaded to thread pool
# ---------------------------------------------------------------------------

def _run_monte_carlo_sync(
    agents_data: list[dict[str, Any]],
    influences_data: list[dict[str, Any]],
    learning_rate: float,
    num_runs: int,
    rounds_per_run: int,
) -> dict[str, Any]:
    """Pure CPU-bound Monte Carlo — runs in a thread to avoid blocking the event loop."""
    results: list[dict[str, Any]] = []

    for run in range(num_runs):
        seed = random.randint(0, 999999)
        agent_copies: list[dict[str, Any]] = []
        for a in agents_data:
            agent_copies.append({
                "id": a["id"],
                "beliefState": dict(a["beliefState"]),
                "confidenceLevel": a["confidenceLevel"],
                "credibilityScore": a["credibilityScore"],
                "activityLevel": a["activityLevel"],
            })

        total_sentiment = 0.0
        total_engagement = 0

        for _ in range(rounds_per_run):
            for agent in agent_copies:
                incoming = [
                    i for i in influences_data if i["target_agent_id"] == agent["id"]
                ]
                for inf in incoming:
                    source = next(
                        (x for x in agent_copies if x["id"] == inf["source_agent_id"]),
                        None,
                    )
                    if source:
                        upd = update_belief(
                            {
                                "beliefState": agent["beliefState"],
                                "confidenceLevel": agent["confidenceLevel"],
                            },
                            float(source["beliefState"]["policySupport"]),
                            float(inf["weight"]) * float(source.get("credibilityScore", 0.5)),
                            learning_rate,
                        )
                        agent["beliefState"] = upd["beliefState"]
                        agent["confidenceLevel"] = upd["confidenceLevel"]

                noise = (random.random() - 0.5) * 0.2
                total_sentiment += agent["beliefState"]["policySupport"] + noise
                if random.random() < float(agent.get("activityLevel", 0.5)):
                    total_engagement += 1

        avg_support = sum(
            a["beliefState"]["policySupport"] for a in agent_copies
        ) / len(agent_copies)

        results.append({
            "runIndex": run,
            "policySupport": avg_support,
            "publicSentiment": total_sentiment / (len(agent_copies) * rounds_per_run),
            "engagement": total_engagement,
            "seed": seed,
        })

    support_scores = [r["policySupport"] for r in results]
    mean = sum(support_scores) / len(support_scores)
    n = len(support_scores)
    denom = (n - 1) if n > 1 else 1
    variance = sum((s - mean) ** 2 for s in support_scores) / denom
    std_dev = variance**0.5
    sorted_s = sorted(support_scores)
    lo_i = int(len(sorted_s) * 0.025) if sorted_s else 0
    hi_i = int(len(sorted_s) * 0.975) if sorted_s else 0
    ci_lower = sorted_s[lo_i] if sorted_s else mean - 1.96 * std_dev
    ci_upper = (
        sorted_s[min(len(sorted_s) - 1, hi_i)]
        if sorted_s
        else mean + 1.96 * std_dev
    )

    return {
        "meanSupport": mean,
        "variance": variance,
        "min": min(support_scores),
        "max": max(support_scores),
        "confidenceInterval": [ci_lower, ci_upper],
        "distribution": results,
    }


async def run_monte_carlo(
    simulation_id: int, num_runs: int, rounds_per_run: int
) -> dict[str, Any]:
    """Read data from DB, then offload CPU-bound MC to a thread."""
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT * FROM simulations WHERE id = $1", simulation_id
        )
        if not sim:
            raise ValueError("Simulation not found")

        _use_neo4j_mc = (
            config.GRAPH_BACKEND == "neo4j" and neo4j_service.is_neo4j_available()
        )

        if _use_neo4j_mc:
            neo4j_agents = await neo4j_service.read_agents_from_graph(simulation_id)
            if not neo4j_agents:
                _use_neo4j_mc = False

        if _use_neo4j_mc:
            agents = neo4j_agents  # type: ignore[assignment]
            agent_ids = [a["id"] for a in agents]
            influences = await neo4j_service.read_influences_from_graph(agent_ids)
        else:
            agents = await conn.fetch(
                "SELECT * FROM agents WHERE simulation_id = $1", simulation_id
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

        cfg = sim["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        learning_rate = float(cfg.get("learningRate", 0.3))

    # Prepare plain dicts for thread safety (asyncpg Records aren't thread-safe)
    agents_data = []
    for a in agents:
        bs = a["belief_state"]
        if isinstance(bs, str):
            bs = json.loads(bs)
        agents_data.append({
            "id": a["id"],
            "beliefState": dict(bs),
            "confidenceLevel": float(a["confidence_level"]),
            "credibilityScore": float(a["credibility_score"]),
            "activityLevel": float(a["activity_level"]),
        })

    influences_data = [
        {
            "source_agent_id": i["source_agent_id"],
            "target_agent_id": i["target_agent_id"],
            "weight": float(i["weight"]),
        }
        for i in influences
    ]

    # Offload to thread pool so the event loop stays responsive
    return await asyncio.to_thread(
        _run_monte_carlo_sync,
        agents_data,
        influences_data,
        learning_rate,
        num_runs,
        rounds_per_run,
    )


def _run_monte_carlo_sync_with_progress(
    agents_data: list[dict[str, Any]],
    influences_data: list[dict[str, Any]],
    learning_rate: float,
    num_runs: int,
    rounds_per_run: int,
    progress_queue: asyncio.Queue[dict[str, Any]],
    loop: asyncio.AbstractEventLoop,
) -> dict[str, Any]:
    """MC with progress events pushed to an asyncio queue."""
    results: list[dict[str, Any]] = []
    report_every = max(1, num_runs // 20)

    for run in range(num_runs):
        seed = random.randint(0, 999999)
        agent_copies = [
            {
                "id": a["id"],
                "beliefState": dict(a["beliefState"]),
                "confidenceLevel": a["confidenceLevel"],
                "credibilityScore": a["credibilityScore"],
                "activityLevel": a["activityLevel"],
            }
            for a in agents_data
        ]

        total_sentiment = 0.0
        total_engagement = 0

        for _ in range(rounds_per_run):
            for agent in agent_copies:
                incoming = [
                    i for i in influences_data if i["target_agent_id"] == agent["id"]
                ]
                for inf in incoming:
                    source = next(
                        (x for x in agent_copies if x["id"] == inf["source_agent_id"]),
                        None,
                    )
                    if source:
                        upd = update_belief(
                            {
                                "beliefState": agent["beliefState"],
                                "confidenceLevel": agent["confidenceLevel"],
                            },
                            float(source["beliefState"]["policySupport"]),
                            float(inf["weight"]) * float(source.get("credibilityScore", 0.5)),
                            learning_rate,
                        )
                        agent["beliefState"] = upd["beliefState"]
                        agent["confidenceLevel"] = upd["confidenceLevel"]

                noise = (random.random() - 0.5) * 0.2
                total_sentiment += agent["beliefState"]["policySupport"] + noise
                if random.random() < float(agent.get("activityLevel", 0.5)):
                    total_engagement += 1

        avg_support = sum(
            a["beliefState"]["policySupport"] for a in agent_copies
        ) / len(agent_copies)

        run_result = {
            "runIndex": run,
            "policySupport": avg_support,
            "publicSentiment": total_sentiment / (len(agent_copies) * rounds_per_run),
            "engagement": total_engagement,
            "seed": seed,
        }
        results.append(run_result)

        if (run + 1) % report_every == 0 or run == num_runs - 1:
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {
                    "type": "mc_progress",
                    "current": run + 1,
                    "total": num_runs,
                    "latestSupport": avg_support,
                },
            )

    support_scores = [r["policySupport"] for r in results]
    mean = sum(support_scores) / len(support_scores)
    n = len(support_scores)
    denom = (n - 1) if n > 1 else 1
    variance = sum((s - mean) ** 2 for s in support_scores) / denom
    std_dev = variance**0.5
    sorted_s = sorted(support_scores)
    lo_i = int(len(sorted_s) * 0.025) if sorted_s else 0
    hi_i = int(len(sorted_s) * 0.975) if sorted_s else 0
    ci_lower = sorted_s[lo_i] if sorted_s else mean - 1.96 * std_dev
    ci_upper = (
        sorted_s[min(len(sorted_s) - 1, hi_i)]
        if sorted_s
        else mean + 1.96 * std_dev
    )

    return {
        "meanSupport": mean,
        "variance": variance,
        "min": min(support_scores),
        "max": max(support_scores),
        "confidenceInterval": [ci_lower, ci_upper],
        "distribution": results,
    }


async def run_monte_carlo_stream(
    simulation_id: int, num_runs: int, rounds_per_run: int
) -> AsyncIterator[dict[str, Any]]:
    """Streaming Monte Carlo — yields progress events then the final result."""
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT * FROM simulations WHERE id = $1", simulation_id
        )
        if not sim:
            yield {"type": "error", "message": "Simulation not found"}
            return

        _use_neo4j_mc = (
            config.GRAPH_BACKEND == "neo4j" and neo4j_service.is_neo4j_available()
        )
        if _use_neo4j_mc:
            neo4j_agents = await neo4j_service.read_agents_from_graph(simulation_id)
            if not neo4j_agents:
                _use_neo4j_mc = False

        if _use_neo4j_mc:
            agents = neo4j_agents  # type: ignore[assignment]
            agent_ids = [a["id"] for a in agents]
            influences = await neo4j_service.read_influences_from_graph(agent_ids)
        else:
            agents = await conn.fetch(
                "SELECT * FROM agents WHERE simulation_id = $1", simulation_id
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

        cfg = sim["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        learning_rate = float(cfg.get("learningRate", 0.3))

    agents_data = []
    for a in agents:
        bs = a["belief_state"]
        if isinstance(bs, str):
            bs = json.loads(bs)
        agents_data.append({
            "id": a["id"],
            "beliefState": dict(bs),
            "confidenceLevel": float(a["confidence_level"]),
            "credibilityScore": float(a["credibility_score"]),
            "activityLevel": float(a["activity_level"]),
        })

    influences_data = [
        {
            "source_agent_id": i["source_agent_id"],
            "target_agent_id": i["target_agent_id"],
            "weight": float(i["weight"]),
        }
        for i in influences
    ]

    yield {
        "type": "status",
        "phase": "start",
        "message": f"Starting Monte Carlo: {num_runs} runs x {rounds_per_run} rounds",
        "numRuns": num_runs,
        "roundsPerRun": rounds_per_run,
    }

    progress_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_event_loop()

    future = asyncio.get_event_loop().run_in_executor(
        None,
        _run_monte_carlo_sync_with_progress,
        agents_data,
        influences_data,
        learning_rate,
        num_runs,
        rounds_per_run,
        progress_queue,
        loop,
    )

    while not future.done():
        try:
            event = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
            yield event
        except asyncio.TimeoutError:
            pass

    # Drain remaining queue items
    while not progress_queue.empty():
        yield progress_queue.get_nowait()

    result = future.result()
    yield {"type": "complete", "result": result}
