from __future__ import annotations

import json
from typing import Any, NotRequired, TypedDict


class AgentPersona(TypedDict):
    name: str
    age: int
    gender: str
    region: str
    occupation: str
    persona: str
    stance: str
    systemPrompt: NotRequired[str | None]


class BeliefState(TypedDict):
    policySupport: float
    trustInGovernment: float
    economicOutlook: float


class AgentContext(TypedDict, total=False):
    persona: AgentPersona
    beliefState: BeliefState
    confidenceLevel: float
    graphContextSummary: str
    event: str
    policyBrief: str


class PostContext(TypedDict, total=False):
    postContent: str
    persona: AgentPersona
    beliefState: BeliefState
    policyBrief: str


def build_agent_action_prompt(ctx: AgentContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    event_line = f"\nExternal event: {ctx['event']}" if ctx.get("event") else ""
    policy_block = ""
    policy_rules = ""
    if ctx.get("policyBrief"):
        policy_block = f"\nPOLICY (discuss ONLY this — no other topics):\n{ctx['policyBrief']}\n"
        policy_rules = (
            "\nYou must write only about the POLICY above. "
            "Do not change the subject. Reference a concrete aspect of those key points when you post or comment."
        )
    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f"\nBehavioral instructions (follow closely): {sp}"
    return f"""Persona: {p['name']}, {p['age']}y {p['gender']}, {p['occupation']} in {p['region']}. Stance: {p['stance']}. Personality: {p['persona']}.{beh}
Beliefs: policy={bs['policySupport']:.2f} trust={bs['trustInGovernment']:.2f} econ={bs['economicOutlook']:.2f} confidence={ctx['confidenceLevel']:.2f}
{policy_block}Network: {ctx['graphContextSummary']}{event_line}
Act as this person on social media. Stay in character. Under 280 chars. No explanations.{policy_rules}
Reply JSON only: {{"action":"post"|"comment"|"ignore","content":"...","sentiment":<-1 to 1>,"target_post_id":null}}"""


def build_agent_reaction_prompt(ctx: PostContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    policy_block = ""
    policy_rules = ""
    if ctx.get("policyBrief"):
        policy_block = f"\nPOLICY (discuss ONLY this):\n{ctx['policyBrief']}\n"
        policy_rules = (
            "\nYour reply must stay on the POLICY above and respond to the post in that context only."
        )
    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f" Behavioral instructions: {sp}"
    return f"""Post: "{ctx['postContent']}"
You: {p['name']}, {p['age']}y {p['occupation']}, {p['region']}. Stance: {p['stance']}. {p['persona']}.{beh}
Beliefs: policy={bs['policySupport']:.2f} trust={bs['trustInGovernment']:.2f} econ={bs['economicOutlook']:.2f}
{policy_block}React in character. Under 280 chars. No explanations.{policy_rules}
Reply JSON only: {{"action":"comment","content":"...","sentiment":<-1 to 1>,"agreement":"agree"|"disagree"|"neutral"}}"""


def build_graph_context_summary(
    neighbors: list[dict[str, Any]],
    recent_posts: list[dict[str, Any]],
) -> str:
    if not neighbors and not recent_posts:
        return "No recent social activity in your network."

    parts: list[str] = []
    if neighbors:
        desc = ", ".join(f"{n['name']} ({n['stance']})" for n in neighbors)
        parts.append(
            f"Your network includes {len(neighbors)} connections: {desc}."
        )
    if recent_posts:
        parts.append("Recent posts in your feed:")
        for post in recent_posts[:5]:
            s = post["sentiment"]
            if s > 0.3:
                label = "positive"
            elif s < -0.3:
                label = "negative"
            else:
                label = "neutral"
            parts.append(
                f"  - {post['agentName']}: \"{post['content']}\" ({label})"
            )
    return "\n".join(parts)
