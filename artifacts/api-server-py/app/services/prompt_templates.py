from __future__ import annotations

import json
from typing import Any, TypedDict


class AgentPersona(TypedDict):
    name: str
    age: int
    gender: str
    region: str
    occupation: str
    persona: str
    stance: str


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


class PostContext(TypedDict):
    postContent: str
    persona: AgentPersona
    beliefState: BeliefState


def build_agent_action_prompt(ctx: AgentContext) -> str:
    persona = ctx["persona"]
    bs = ctx["beliefState"]
    event_block = ""
    if ctx.get("event"):
        event_block = f"[EXTERNAL EVENT]\n{ctx['event']}\n"
    return f"""You are a human with the following persona:

[PERSONA]
{json.dumps(persona, indent=2)}

[CURRENT BELIEF STATE]
Policy Support: {bs['policySupport']:.3f} (range: -1 to 1)
Trust in Government: {bs['trustInGovernment']:.3f}
Economic Outlook: {bs['economicOutlook']:.3f}
Confidence Level: {ctx['confidenceLevel']:.3f}

[RECENT SOCIAL CONTEXT]
{ctx['graphContextSummary']}

{event_block}INSTRUCTIONS:
- Act like a real human, not an AI
- Be consistent with your personality and beliefs
- You may change your opinion slightly if influenced
- Keep responses natural, emotional, and varied
- Do NOT explain reasoning
- Keep your post/comment under 280 characters

OUTPUT FORMAT (respond with valid JSON only):
{{
  "action": "post" | "comment" | "ignore",
  "content": "your natural human-like response here",
  "sentiment": <float between -1 and 1>,
  "target_post_id": null
}}"""


def build_agent_reaction_prompt(ctx: PostContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    return f"""You are reacting to a post on social media.

POST:
{ctx['postContent']}

YOUR PERSONA:
Name: {p['name']}
Age: {p['age']}
Occupation: {p['occupation']}
Region: {p['region']}
Stance: {p['stance']}
Personality: {p['persona']}

YOUR BELIEFS:
Policy Support: {bs['policySupport']:.3f}
Trust in Government: {bs['trustInGovernment']:.3f}
Economic Outlook: {bs['economicOutlook']:.3f}

INSTRUCTIONS:
- Do you agree, disagree, or stay neutral?
- Respond emotionally if it fits your persona
- Keep it under 280 characters
- Be authentic to your character

OUTPUT FORMAT (respond with valid JSON only):
{{
  "action": "comment",
  "content": "your reaction here",
  "sentiment": <float between -1 and 1>,
  "agreement": "agree" | "disagree" | "neutral"
}}"""


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
