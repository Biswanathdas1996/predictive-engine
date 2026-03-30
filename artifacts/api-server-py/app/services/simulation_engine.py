from __future__ import annotations

import json
import logging
import random
from typing import Any, Literal, TypedDict, cast

import asyncpg

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
    if random.random() > agent["activityLevel"]:
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
        import json

        bs = json.loads(bs)
    return AgentRow(
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


async def generate_llm_action(
    agent: AgentRow,
    round_num: int,
    recent_posts: list[dict[str, Any]],
    neighbors: list[dict[str, str]],
    event: str | None = None,
) -> tuple[Literal["post", "comment", "ignore"], str, float]:
    graph_summary = build_graph_context_summary(neighbors, recent_posts)
    prompt = build_agent_action_prompt(
        {
            "persona": {
                "name": agent["name"],
                "age": agent["age"],
                "gender": agent["gender"],
                "region": agent["region"],
                "occupation": agent["occupation"],
                "persona": agent["persona"],
                "stance": agent["stance"],
            },
            "beliefState": agent["beliefState"],
            "confidenceLevel": agent["confidenceLevel"],
            "graphContextSummary": graph_summary,
            **({"event": event} if event else {}),
        }
    )
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
    a, c, s = generate_deterministic_action(agent, round_num)
    return a, c, s


async def run_simulation_round(simulation_id: int) -> dict[str, Any]:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT * FROM simulations WHERE id = $1", simulation_id
        )
        if not sim:
            raise ValueError("Simulation not found")

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
            import json

            cfg = json.loads(cfg)
        learning_rate = float(cfg.get("learningRate", 0.3))

        use_llm = llm_service.is_llm_available()

        recent_posts: list[dict[str, Any]] = []
        if use_llm:
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

        agent_states: list[dict[str, Any]] = []
        total_sentiment = 0.0
        total_policy_support = 0.0
        posts_generated = 0
        beliefs_updated = 0

        round_posts: list[dict[str, Any]] = []

        agents_by_id = {a["id"]: a for a in agents}

        for agent in agents:
            agent_row = _to_agent_row(agent)

            incoming = [i for i in influences if i["target_agent_id"] == agent["id"]]
            for inf in incoming:
                source = agents_by_id.get(inf["source_agent_id"])
                if source:
                    source_bs = source["belief_state"]
                    if isinstance(source_bs, str):
                        import json

                        source_bs = json.loads(source_bs)
                    upd = update_belief(
                        {
                            "beliefState": agent_row["beliefState"],
                            "confidenceLevel": agent_row["confidenceLevel"],
                        },
                        float(source_bs["policySupport"]),
                        float(inf["weight"]) * float(source["credibility_score"]),
                        learning_rate,
                    )
                    agent_row["beliefState"] = upd["beliefState"]  # type: ignore[assignment]
                    agent_row["confidenceLevel"] = upd["confidenceLevel"]
                    beliefs_updated += 1

            if use_llm:
                neighbor_list = []
                for inf in incoming:
                    src = agents_by_id.get(inf["source_agent_id"])
                    if src:
                        neighbor_list.append(
                            {"name": src["name"], "stance": src["stance"]}
                        )
                action, content, sentiment = await generate_llm_action(
                    agent_row, new_round, recent_posts, neighbor_list
                )
            else:
                action, content, sentiment = generate_deterministic_action(
                    agent_row, new_round
                )

            if action != "ignore" and content:
                tags: list[str] = []
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
                        content,
                        sentiment,
                        "simulation",
                        tags,
                        new_round,
                        agent["id"],
                        simulation_id,
                    )
                    round_posts.append(
                        {
                            "id": post["id"],
                            "content": content,
                            "sentiment": sentiment,
                            "agentId": agent["id"],
                        }
                    )
                    if neo4j_service.is_neo4j_available():
                        try:
                            await neo4j_service.sync_post_to_graph(
                                {
                                    "id": post["id"],
                                    "content": content,
                                    "sentiment": sentiment,
                                    "platform": "simulation",
                                    "topicTags": tags,
                                    "round": new_round,
                                    "agentId": agent["id"],
                                    "simulationId": simulation_id,
                                }
                            )
                        except Exception as err:
                            logger.warning("Failed to sync post to Neo4j: %s", err)
                elif action == "comment" and round_posts:
                    target = random.choice(round_posts)
                    comment = await conn.fetchrow(
                        """INSERT INTO comments
                        (content, sentiment, round, agent_id, post_id, simulation_id)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        RETURNING *""",
                        content,
                        sentiment,
                        new_round,
                        agent["id"],
                        target["id"],
                        simulation_id,
                    )
                    if neo4j_service.is_neo4j_available():
                        try:
                            await neo4j_service.sync_comment_to_graph(
                                {
                                    "id": comment["id"],
                                    "content": content,
                                    "sentiment": sentiment,
                                    "round": new_round,
                                    "agentId": agent["id"],
                                    "postId": target["id"],
                                    "simulationId": simulation_id,
                                }
                            )
                        except Exception as err:
                            logger.warning("Failed to sync comment to Neo4j: %s", err)
                else:
                    post = await conn.fetchrow(
                        """INSERT INTO posts
                        (content, sentiment, platform, topic_tags, round, agent_id, simulation_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        RETURNING *""",
                        content,
                        sentiment,
                        "simulation",
                        tags,
                        new_round,
                        agent["id"],
                        simulation_id,
                    )
                    round_posts.append(
                        {
                            "id": post["id"],
                            "content": content,
                            "sentiment": sentiment,
                            "agentId": agent["id"],
                        }
                    )
                posts_generated += 1

            await conn.execute(
                """UPDATE agents SET belief_state = $1::jsonb, confidence_level = $2
                   WHERE id = $3""",
                json.dumps(agent_row["beliefState"]),
                agent_row["confidenceLevel"],
                agent["id"],
            )

            if neo4j_service.is_neo4j_available():
                try:
                    ag = dict(agent)
                    ag["belief_state"] = agent_row["beliefState"]
                    ag["beliefState"] = agent_row["beliefState"]
                    ag["confidence_level"] = agent_row["confidenceLevel"]
                    ag["confidenceLevel"] = agent_row["confidenceLevel"]
                    await neo4j_service.sync_agent_to_graph(ag)
                except Exception as err:
                    logger.warning("Failed to sync agent to Neo4j: %s", err)

            total_sentiment += sentiment
            total_policy_support += agent_row["beliefState"]["policySupport"]

            agent_states.append(
                {
                    "agentId": agent["id"],
                    "name": agent["name"],
                    "policySupport": agent_row["beliefState"]["policySupport"],
                    "confidenceLevel": agent_row["confidenceLevel"],
                    "action": action,
                    "sentiment": sentiment,
                }
            )

        ignored = [s for s in agent_states if s["action"] == "ignore"]
        for ignored_state in ignored[:3]:
            if not round_posts:
                break
            if random.random() > 0.3:
                continue
            reacting = agents_by_id.get(ignored_state["agentId"])
            if not reacting:
                continue
            agent_row = _to_agent_row(reacting)
            target_post = random.choice(round_posts)
            if use_llm:
                rprompt = build_agent_reaction_prompt(
                    {
                        "postContent": target_post["content"],
                        "persona": {
                            "name": agent_row["name"],
                            "age": agent_row["age"],
                            "gender": agent_row["gender"],
                            "region": agent_row["region"],
                            "occupation": agent_row["occupation"],
                            "persona": agent_row["persona"],
                            "stance": agent_row["stance"],
                        },
                        "beliefState": agent_row["beliefState"],
                    }
                )
                result = await llm_service.generate_agent_action(rprompt)
                if result and result.get("content"):
                    reaction_content = str(result["content"])
                    reaction_sentiment = float(result.get("sentiment", 0))
                else:
                    reaction_content, reaction_sentiment = (
                        generate_deterministic_reaction(
                            agent_row,
                            target_post["content"],
                            float(target_post["sentiment"]),
                            new_round,
                        )
                    )
            else:
                reaction_content, reaction_sentiment = generate_deterministic_reaction(
                    agent_row,
                    target_post["content"],
                    float(target_post["sentiment"]),
                    new_round,
                )

            comment = await conn.fetchrow(
                """INSERT INTO comments
                (content, sentiment, round, agent_id, post_id, simulation_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *""",
                reaction_content,
                reaction_sentiment,
                new_round,
                reacting["id"],
                target_post["id"],
                simulation_id,
            )
            if neo4j_service.is_neo4j_available():
                try:
                    await neo4j_service.sync_comment_to_graph(
                        {
                            "id": comment["id"],
                            "content": reaction_content,
                            "sentiment": reaction_sentiment,
                            "round": new_round,
                            "agentId": reacting["id"],
                            "postId": target_post["id"],
                            "simulationId": simulation_id,
                        }
                    )
                except Exception as err:
                    logger.warning("Failed to sync reaction to Neo4j: %s", err)

        def _bs(rec: asyncpg.Record) -> dict[str, Any]:
            b = rec["belief_state"]
            if isinstance(b, str):
                return json.loads(b)
            return b

        avg_trust = sum(float(_bs(a).get("trustInGovernment", 0.5)) for a in agents) / len(
            agents
        )
        avg_econ = sum(float(_bs(a).get("economicOutlook", 0.5)) for a in agents) / len(
            agents
        )

        await conn.execute(
            """INSERT INTO belief_snapshots
            (simulation_id, round, average_policy_support, average_trust_in_government, average_economic_outlook)
            VALUES ($1, $2, $3, $4, $5)""",
            simulation_id,
            new_round,
            total_policy_support / len(agents),
            avg_trust,
            avg_econ,
        )

        await conn.execute(
            """UPDATE simulations SET current_round = $1, status = $2 WHERE id = $3""",
            new_round,
            "running",
            simulation_id,
        )

        return {
            "round": new_round,
            "postsGenerated": posts_generated,
            "beliefsUpdated": beliefs_updated,
            "averageSentiment": total_sentiment / len(agents),
            "averagePolicySupport": total_policy_support / len(agents),
            "agentStates": agent_states,
        }


async def run_monte_carlo(
    simulation_id: int, num_runs: int, rounds_per_run: int
) -> dict[str, Any]:
    p = pool()
    async with p.acquire() as conn:
        sim = await conn.fetchrow(
            "SELECT * FROM simulations WHERE id = $1", simulation_id
        )
        if not sim:
            raise ValueError("Simulation not found")

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
            import json

            cfg = json.loads(cfg)
        learning_rate = float(cfg.get("learningRate", 0.3))

        results: list[dict[str, Any]] = []

        for run in range(num_runs):
            seed = random.randint(0, 999999)
            agent_copies: list[dict[str, Any]] = []
            for a in agents:
                bs = a["belief_state"]
                if isinstance(bs, str):
                    import json

                    bs = json.loads(bs)
                agent_copies.append(
                    {
                        "id": a["id"],
                        "beliefState": dict(bs),
                        "confidenceLevel": float(a["confidence_level"]),
                        "credibilityScore": float(a["credibility_score"]),
                        "activityLevel": float(a["activity_level"]),
                    }
                )

            total_sentiment = 0.0
            total_engagement = 0

            for _ in range(rounds_per_run):
                for agent in agent_copies:
                    incoming = [
                        i for i in influences if i["target_agent_id"] == agent["id"]
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
                                float(inf["weight"])
                                * float(source.get("credibilityScore", 0.5)),
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

            results.append(
                {
                    "runIndex": run,
                    "policySupport": avg_support,
                    "publicSentiment": total_sentiment
                    / (len(agent_copies) * rounds_per_run),
                    "engagement": total_engagement,
                    "seed": seed,
                }
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
        ci_lower = (
            sorted_s[lo_i]
            if sorted_s
            else mean - 1.96 * std_dev
        )
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
