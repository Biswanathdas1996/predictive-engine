"""Human user replies on a post + mandatory follow-up comments from linked agents."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import asyncpg

from app.serialize import agent_row, comment_row
from app.services import llm_service, neo4j_service
from app.services.llm_service import generate_agent_action, is_llm_available
from app.services.prompt_templates import build_user_thread_reply_prompt
from app.services.simulation_engine import (
    _config_policy_id,
    _connection_with_round_lock,
    _external_events_prompt_text,
    _to_agent_row,
    generate_deterministic_reaction,
)

logger = logging.getLogger(__name__)

_FACILITATOR_INSERT = """INSERT INTO agents (
    name, age, gender, region, occupation, persona, stance,
    influence_score, credibility_score, belief_state, confidence_level,
    activity_level, group_id, simulation_id, system_prompt, is_facilitator
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)
RETURNING *"""


async def ensure_facilitator_agent(conn: asyncpg.Connection, simulation_id: int) -> asyncpg.Record:
    row = await conn.fetchrow(
        "SELECT * FROM agents WHERE simulation_id = $1 AND is_facilitator = true LIMIT 1",
        simulation_id,
    )
    if row:
        return row
    default_bs = {"policySupport": 0.0, "trustInGovernment": 0.5, "economicOutlook": 0.5}
    row = await conn.fetchrow(
        _FACILITATOR_INSERT,
        "You",
        35,
        "unspecified",
        "—",
        "Human facilitator",
        "You represent the human operator steering this simulation. You do not participate in automated rounds.",
        "neutral",
        0.5,
        0.5,
        json.dumps(default_bs),
        0.5,
        0.5,
        None,
        simulation_id,
        "The human user types through you in the UI; your comments are their voice.",
        True,
    )
    if row:
        asyncio.create_task(neo4j_service.sync_agent_to_graph(agent_row(row)))
    return row


def _respondent_agent_ids(
    post_author_id: int,
    comment_rows: list[asyncpg.Record],
    facilitator_id: int,
) -> list[int]:
    ids: set[int] = {int(post_author_id)}
    for cr in comment_rows:
        ids.add(int(cr["agent_id"]))
    ids.discard(int(facilitator_id))
    return sorted(ids)


async def _policy_brief_for_sim(conn: asyncpg.Connection, cfg: dict[str, Any]) -> str | None:
    policy_id = _config_policy_id(cfg)
    if policy_id is None:
        return None
    prow = await conn.fetchrow(
        "SELECT title, summary FROM policies WHERE id = $1",
        policy_id,
    )
    if not prow:
        return None
    title = str(prow["title"] or "")
    summary = str(prow["summary"] or "")
    try:
        return await llm_service.policy_key_points_brief(title, summary)
    except Exception as exc:
        logger.warning("user thread reply: policy brief fallback (%s)", exc)
        return f"{title}\n{summary}"[:2000]


async def _one_agent_reply(
    *,
    agent_rec: asyncpg.Record,
    post_content: str,
    post_author_name: str,
    user_comment_text: str,
    reply_round: int,
    post_id: int,
    simulation_id: int,
    conn: asyncpg.Connection,
    policy_brief: str | None,
    event_line: str | None,
) -> dict[str, Any]:
    ar = _to_agent_row(agent_rec)
    persona: dict[str, Any] = {
        "name": ar["name"],
        "age": ar["age"],
        "gender": ar["gender"],
        "region": ar["region"],
        "occupation": ar["occupation"],
        "persona": ar["persona"],
        "stance": ar["stance"],
    }
    if ar.get("systemPrompt"):
        persona["systemPrompt"] = ar["systemPrompt"]
    prompt = build_user_thread_reply_prompt(
        post_content=post_content,
        post_author_name=post_author_name,
        user_comment=user_comment_text,
        persona=persona,
        belief_state=ar["beliefState"],
        policy_brief=policy_brief,
        event_line=event_line,
    )
    content = ""
    sentiment = 0.0
    if is_llm_available():
        parsed = await generate_agent_action(prompt)
        if parsed and parsed.get("content"):
            content = str(parsed["content"])[:2000]
            sentiment = float(parsed.get("sentiment", 0))
    if not content.strip():
        content, sentiment = generate_deterministic_reaction(
            ar, user_comment_text, 0.0, reply_round
        )
    row = await conn.fetchrow(
        """INSERT INTO comments
        (content, sentiment, round, agent_id, post_id, simulation_id)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
        content.strip(),
        float(sentiment),
        reply_round,
        int(agent_rec["id"]),
        post_id,
        simulation_id,
    )
    c_dict = comment_row(
        row,
        agent_name=str(agent_rec["name"] or "Unknown"),
        agent=agent_rec,
    )
    asyncio.create_task(neo4j_service.sync_comment_to_graph(c_dict))
    return c_dict


async def apply_user_post_reply_stream(
    simulation_id: int,
    post_id: int,
    content: str,
) -> AsyncIterator[dict[str, Any]]:
    """Insert facilitator comment, then yield one SSE-style event per agent reply (same DB lock as JSON path)."""
    if not content.strip():
        raise ValueError("Comment content is empty.")
    text = content.strip()
    if len(text) > 4000:
        raise ValueError("Comment is too long (max 4000 characters).")

    if not is_llm_available():
        raise ValueError(
            "PwC GenAI is required to generate agent replies. "
            "Set PWC_GENAI_API_KEY or PWC_GENAI_BEARER_TOKEN."
        )

    async with _connection_with_round_lock(simulation_id) as conn:
        sim = await conn.fetchrow("SELECT * FROM simulations WHERE id = $1", simulation_id)
        if not sim:
            raise ValueError("Simulation not found")
        cfg = sim["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)

        post = await conn.fetchrow(
            "SELECT * FROM posts WHERE id = $1 AND simulation_id = $2",
            post_id,
            simulation_id,
        )
        if not post:
            raise ValueError("Post not found in this simulation")

        facilit = await ensure_facilitator_agent(conn, simulation_id)
        fac_id = int(facilit["id"])

        existing_comments = await conn.fetch(
            """SELECT * FROM comments WHERE post_id = $1 AND simulation_id = $2
               ORDER BY created_at ASC""",
            post_id,
            simulation_id,
        )
        respondents = _respondent_agent_ids(
            int(post["agent_id"]), list(existing_comments), fac_id
        )
        if not respondents:
            raise ValueError("No simulated agents are linked to this thread yet.")

        reply_round = max(int(sim["current_round"]), 1)

        user_row = await conn.fetchrow(
            """INSERT INTO comments
            (content, sentiment, round, agent_id, post_id, simulation_id)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
            text,
            0.0,
            reply_round,
            fac_id,
            post_id,
            simulation_id,
        )
        user_out = comment_row(
            user_row,
            agent_name=str(facilit["name"] or "You"),
            agent=facilit,
        )
        asyncio.create_task(neo4j_service.sync_comment_to_graph(user_out))

        yield {"type": "user_comment", "comment": user_out}

        author_rec = await conn.fetchrow("SELECT * FROM agents WHERE id = $1", post["agent_id"])
        post_author_name = str(author_rec["name"]) if author_rec else "Unknown"
        post_content = str(post["content"] or "")

        policy_brief = await _policy_brief_for_sim(conn, cfg)
        event_line = await _external_events_prompt_text(conn, cfg)

        n = len(respondents)
        yield {
            "type": "status",
            "phase": "agent_replies",
            "message": f"Generating {n} agent repl{'y' if n == 1 else 'ies'}…",
            "current": 0,
            "total": n,
        }

        agent_replies: list[dict[str, Any]] = []
        idx = 0
        for aid in respondents:
            ag = await conn.fetchrow(
                """SELECT * FROM agents WHERE id = $1 AND simulation_id = $2
                   AND COALESCE(is_facilitator, false) = false""",
                aid,
                simulation_id,
            )
            if not ag:
                continue
            aname = str(ag["name"] or "Agent")
            yield {
                "type": "status",
                "phase": "generating",
                "message": f"{aname} is replying…",
                "current": idx,
                "total": n,
            }
            rep = await _one_agent_reply(
                agent_rec=ag,
                post_content=post_content,
                post_author_name=post_author_name,
                user_comment_text=text,
                reply_round=reply_round,
                post_id=post_id,
                simulation_id=simulation_id,
                conn=conn,
                policy_brief=policy_brief,
                event_line=event_line,
            )
            agent_replies.append(rep)
            idx += 1
            yield {
                "type": "agent_reply",
                "comment": rep,
                "current": idx,
                "total": n,
            }

        yield {
            "type": "complete",
            "respondentAgentIds": respondents,
            "agentReplies": agent_replies,
        }


async def apply_user_post_reply(
    simulation_id: int,
    post_id: int,
    content: str,
) -> dict[str, Any]:
    user_out: dict[str, Any] | None = None
    agent_replies: list[dict[str, Any]] = []
    respondents: list[int] = []
    async for ev in apply_user_post_reply_stream(simulation_id, post_id, content):
        t = ev.get("type")
        if t == "user_comment":
            user_out = ev["comment"]  # type: ignore[assignment]
        elif t == "complete":
            respondents = list(ev.get("respondentAgentIds") or [])
            agent_replies = list(ev.get("agentReplies") or [])
    if user_out is None:
        raise ValueError("Reply failed.")
    return {
        "userComment": user_out,
        "agentReplies": agent_replies,
        "respondentAgentIds": respondents,
    }
