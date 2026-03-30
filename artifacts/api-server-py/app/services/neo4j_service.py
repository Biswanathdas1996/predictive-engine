from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Literal

logger = logging.getLogger(__name__)

_driver: Any = None
_neo4j_available = False


def is_neo4j_available() -> bool:
    return _neo4j_available and _driver is not None


def neo4j_env_configured() -> bool:
    return bool(
        os.environ.get("NEO4J_URI")
        and os.environ.get("NEO4J_USER")
        and os.environ.get("NEO4J_PASSWORD")
    )


def get_neo4j_status() -> Literal["connected", "disabled", "error"]:
    if not neo4j_env_configured():
        return "disabled"
    if is_neo4j_available():
        return "connected"
    return "error"


async def init_neo4j() -> bool:
    global _driver, _neo4j_available

    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER")
    password = os.environ.get("NEO4J_PASSWORD")

    if not uri or not user or not password:
        logger.info(
            "Neo4j credentials not configured — graph features disabled. "
            "Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD to enable."
        )
        _neo4j_available = False
        return False

    try:
        from neo4j import GraphDatabase

        def make_driver():
            d = GraphDatabase.driver(uri, auth=(user, password))
            d.verify_connectivity()
            return d

        _driver = await asyncio.to_thread(make_driver)
        _neo4j_available = True
        logger.info("Neo4j connected successfully")
        await _init_schema()
        return True
    except Exception as exc:
        logger.warning("Neo4j connection failed — graph features disabled: %s", exc)
        _driver = None
        _neo4j_available = False
        return False


async def close_neo4j() -> None:
    global _driver, _neo4j_available
    d = _driver
    _driver = None
    _neo4j_available = False
    if d is not None:
        await asyncio.to_thread(d.close)


def _session_run(query: str, params: dict[str, Any] | None = None) -> None:
    if _driver is None:
        return
    with _driver.session() as session:
        session.run(query, params or {})


async def _run(query: str, params: dict[str, Any] | None = None) -> None:
    if not is_neo4j_available():
        return
    await asyncio.to_thread(_session_run, query, params)


async def _init_schema() -> None:
    indexes = [
        "CREATE INDEX agent_id_index IF NOT EXISTS FOR (a:Agent) ON (a.agent_id)",
        "CREATE INDEX post_id_index IF NOT EXISTS FOR (p:Post) ON (p.post_id)",
        "CREATE INDEX simulation_id_index IF NOT EXISTS FOR (s:Simulation) ON (s.simulation_id)",
        "CREATE INDEX group_id_index IF NOT EXISTS FOR (g:Group) ON (g.group_id)",
        "CREATE INDEX comment_id_index IF NOT EXISTS FOR (c:Comment) ON (c.comment_id)",
        "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Entity) ON (e.entity_id)",
        "CREATE INDEX event_id_index IF NOT EXISTS FOR (ev:Event) ON (ev.event_id)",
        "CREATE INDEX policy_id_index IF NOT EXISTS FOR (p:Policy) ON (p.policy_id)",
    ]
    for idx in indexes:
        await _run(idx)
    logger.info("Neo4j schema indexes initialized")


async def sync_agent_to_graph(agent: dict[str, Any]) -> None:
    if not is_neo4j_available():
        return
    belief = agent.get("beliefState") or agent.get("belief_state") or {}
    if isinstance(belief, str):
        belief = json.loads(belief)
    await _run(
        """MERGE (a:Agent {agent_id: $agentId})
       SET a.name = $name,
           a.age = $age,
           a.gender = $gender,
           a.region = $region,
           a.occupation = $occupation,
           a.persona = $persona,
           a.stance = $stance,
           a.influence_score = $influenceScore,
           a.credibility_score = $credibilityScore,
           a.belief_state = $beliefState,
           a.confidence_level = $confidenceLevel,
           a.activity_level = $activityLevel""",
        {
            "agentId": str(agent["id"]),
            "name": agent["name"],
            "age": agent["age"],
            "gender": agent["gender"],
            "region": agent["region"],
            "occupation": agent["occupation"],
            "persona": agent["persona"],
            "stance": agent["stance"],
            "influenceScore": agent["influenceScore"]
            if "influenceScore" in agent
            else agent.get("influence_score"),
            "credibilityScore": agent["credibilityScore"]
            if "credibilityScore" in agent
            else agent.get("credibility_score"),
            "beliefState": json.dumps(belief),
            "confidenceLevel": agent["confidenceLevel"]
            if "confidenceLevel" in agent
            else agent.get("confidence_level"),
            "activityLevel": agent["activityLevel"]
            if "activityLevel" in agent
            else agent.get("activity_level"),
        },
    )
    sim_id = agent.get("simulationId") or agent.get("simulation_id")
    if sim_id:
        await _run(
            """MATCH (a:Agent {agent_id: $agentId})
         MERGE (s:Simulation {simulation_id: $simId})
         MERGE (a)-[:PART_OF]->(s)""",
            {"agentId": str(agent["id"]), "simId": str(sim_id)},
        )
    gid = agent.get("groupId") or agent.get("group_id")
    if gid:
        await _run(
            """MATCH (a:Agent {agent_id: $agentId})
         MERGE (g:Group {group_id: $groupId})
         MERGE (a)-[:BELONGS_TO]->(g)""",
            {"agentId": str(agent["id"]), "groupId": str(gid)},
        )


async def sync_influence_to_graph(
    source_agent_id: int, target_agent_id: int, weight: float
) -> None:
    if not is_neo4j_available():
        return
    await _run(
        """MATCH (source:Agent {agent_id: $sourceId})
       MATCH (target:Agent {agent_id: $targetId})
       MERGE (source)-[r:INFLUENCES]->(target)
       SET r.weight = $weight""",
        {
            "sourceId": str(source_agent_id),
            "targetId": str(target_agent_id),
            "weight": weight,
        },
    )


async def sync_post_to_graph(post: dict[str, Any]) -> None:
    if not is_neo4j_available():
        return
    await _run(
        """MERGE (p:Post {post_id: $postId})
       SET p.content = $content,
           p.sentiment = $sentiment,
           p.platform = $platform,
           p.topic_tags = $topicTags,
           p.round = $round,
           p.simulation_id = $simulationId,
           p.timestamp = datetime()
       WITH p
       MATCH (a:Agent {agent_id: $agentId})
       MERGE (a)-[:AUTHORED]->(p)
       WITH p
       MATCH (s:Simulation {simulation_id: $simId})
       MERGE (p)-[:PART_OF]->(s)""",
        {
            "postId": str(post["id"]),
            "content": post["content"],
            "sentiment": post["sentiment"],
            "platform": post["platform"],
            "topicTags": post.get("topicTags") or post.get("topic_tags") or [],
            "round": post["round"],
            "agentId": str(post["agentId"] if "agentId" in post else post["agent_id"]),
            "simulationId": str(
                post["simulationId"] if "simulationId" in post else post["simulation_id"]
            ),
            "simId": str(post["simulationId"] if "simulationId" in post else post["simulation_id"]),
        },
    )


async def sync_comment_to_graph(comment: dict[str, Any]) -> None:
    if not is_neo4j_available():
        return
    await _run(
        """MERGE (c:Comment {comment_id: $commentId})
       SET c.content = $content,
           c.sentiment = $sentiment,
           c.round = $round,
           c.simulation_id = $simulationId,
           c.timestamp = datetime()
       WITH c
       MATCH (a:Agent {agent_id: $agentId})
       MERGE (a)-[:COMMENTED]->(c)
       WITH c
       MATCH (p:Post {post_id: $postId})
       MERGE (c)-[:REPLY_TO]->(p)""",
        {
            "commentId": str(comment["id"]),
            "content": comment["content"],
            "sentiment": comment["sentiment"],
            "round": comment["round"],
            "agentId": str(comment["agentId"] if "agentId" in comment else comment["agent_id"]),
            "postId": str(comment["postId"] if "postId" in comment else comment["post_id"]),
            "simulationId": str(
                comment["simulationId"]
                if "simulationId" in comment
                else comment["simulation_id"]
            ),
        },
    )


async def sync_event_to_graph(event: dict[str, Any]) -> None:
    if not is_neo4j_available():
        return
    await _run(
        """MERGE (e:Event {event_id: $eventId})
       SET e.type = $type,
           e.description = $description,
           e.impact_score = $impactScore,
           e.timestamp = datetime()""",
        {
            "eventId": str(event["id"]),
            "type": event["type"],
            "description": event["description"],
            "impactScore": event["impactScore"]
            if "impactScore" in event
            else event.get("impact_score"),
        },
    )


async def sync_policy_to_graph(policy: dict[str, Any]) -> None:
    if not is_neo4j_available():
        return
    await _run(
        """MERGE (p:Policy {policy_id: $policyId})
       SET p.title = $title,
           p.summary = $summary""",
        {
            "policyId": str(policy["id"]),
            "title": policy["title"],
            "summary": policy["summary"],
        },
    )
