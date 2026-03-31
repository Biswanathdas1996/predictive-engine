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
    # Round-based interaction fields
    roundMode: int                         # 1=independent post, 2=reply to other, 3=reply to comment on own post, 4=join thread
    targetPost: dict[str, Any] | None      # specific post the agent should reply to
    targetComment: dict[str, Any] | None   # specific comment on own post (round 3)
    peerHighlights: list[str]              # other agents' snippets that thematically match this agent
    orchestratorDirective: str             # instruction from the orchestrator LLM for this specific agent


class PostContext(TypedDict, total=False):
    postContent: str
    postAuthor: str
    persona: AgentPersona
    beliefState: BeliefState
    policyBrief: str


def build_agent_action_prompt(ctx: AgentContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    event_line = f"\nExternal event: {ctx['event']}" if ctx.get("event") else ""

    policy_block = ""
    policy_anchor = ""
    if ctx.get("policyBrief"):
        policy_block = f"\nPOLICY (discuss ONLY this — no other topics):\n{ctx['policyBrief']}\n"
        policy_anchor = (
            "\nYou MUST write only about the POLICY above — no other topics. "
            "You have FULL AUTONOMY to take a clear, opinionated position on this policy. "
            "Apply your specialized expertise: analyze through your professional lens, name what this policy means for your domain, and cite a specific provision or concrete outcome to ground your argument. "
            "Do NOT hedge — state your view directly."
        )

    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f"\nDomain expertise & behavioral mandate (apply unconditionally): {sp}"

    round_mode = ctx.get("roundMode", 0)
    target_post: dict[str, Any] | None = ctx.get("targetPost")
    target_comment: dict[str, Any] | None = ctx.get("targetComment")
    peer_highlights: list[str] = ctx.get("peerHighlights") or []

    # ── Round-mode instructions ──────────────────────────────────────────────
    if round_mode == 1:
        round_instruction = (
            "\nROUND 1 — INDEPENDENT THOUGHT:"
            "\nShare your first, uninfluenced perspective on this topic. "
            "Do NOT reply to or mention any other agent. "
            "This is your opening statement — make it personal and grounded in your background."
            '\nYou MUST set action to "post" and target_post_id to null.'
        )
        target_block = ""

    elif round_mode == 2:
        if target_post:
            target_block = (
                f'\nPOST TO REPLY TO (Post id {target_post.get("id")}):'
                f'\n  {target_post.get("agentName", "Unknown")}: "{target_post.get("content", "")}"'
            )
        else:
            target_block = ""
        round_instruction = (
            "\nROUND 2 — BUILD ON ANOTHER AGENT'S THOUGHT:"
            "\nPick the post shown above (or any post from the feed) by a DIFFERENT agent and build upon it, extend the idea, or respectfully challenge it. "
            "If the thought resonates with your view, say so explicitly (e.g. 'Like [Name] said...'). "
            "If it contradicts your view, push back directly (e.g. 'Unlike [Name] who argues...')."
            "\nYou MUST set action to \"comment\" and target_post_id to that post's integer id."
        )

    elif round_mode == 3:
        if target_post and target_comment:
            target_block = (
                f'\nYOUR ORIGINAL POST (Post id {target_post.get("id")}):'
                f'\n  You: "{target_post.get("content", "")}"'
                f'\nCOMMENT ON YOUR POST (from {target_comment.get("agentName", "Unknown")}):'
                f'\n  {target_comment.get("agentName", "Unknown")}: "{target_comment.get("content", "")}"'
            )
            round_instruction = (
                "\nROUND 3 — REPLY TO A COMMENT ON YOUR OWN POST:"
                "\nSomeone has commented on your post above. "
                "Reply to their comment — address what they said, extend the argument, or challenge it. Keep the conversation going."
                f"\nYou MUST set action to \"comment\" and target_post_id to {target_post.get('id')} (your original post)."
            )
        elif target_post:
            # Fallback: no comment found, behave like round 2
            target_block = (
                f'\nPOST TO REPLY TO (Post id {target_post.get("id")}):'
                f'\n  {target_post.get("agentName", "Unknown")}: "{target_post.get("content", "")}"'
            )
            round_instruction = (
                "\nROUND 3 — BUILD ON ANOTHER AGENT'S THOUGHT:"
                "\nPick the post shown above by a different agent and build upon it."
                "\nYou MUST set action to \"comment\" and target_post_id to that post's integer id."
            )
        else:
            target_block = ""
            round_instruction = (
                "\nPost your thoughts on this topic."
                '\nSet action to "post" and target_post_id to null.'
            )

    elif round_mode == 4:
        if target_post and target_comment:
            target_block = (
                f'\nCONVERSATION THREAD — POST (Post id {target_post.get("id")}):'
                f'\n  {target_post.get("agentName", "Unknown")}: "{target_post.get("content", "")}"'
                f'\n  Comment by {target_comment.get("agentName", "Unknown")}: "{target_comment.get("content", "")}"'
            )
            round_instruction = (
                "\nROUND 4 — JOIN AN EXISTING CONVERSATION:"
                "\nThe thread above has already attracted a reply. "
                "Add your voice by replying to the ORIGINAL POST — not the comment. "
                "Acknowledge the thread exists and contribute a new angle."
                f"\nYou MUST set action to \"comment\" and target_post_id to {target_post.get('id')}."
            )
        elif target_post:
            target_block = (
                f'\nPOST TO REPLY TO (Post id {target_post.get("id")}):'
                f'\n  {target_post.get("agentName", "Unknown")}: "{target_post.get("content", "")}"'
            )
            round_instruction = (
                "\nROUND 4 — JOIN AN EXISTING CONVERSATION:"
                "\nReply to the post shown above and add your perspective."
                "\nYou MUST set action to \"comment\" and target_post_id to that post's integer id."
            )
        else:
            target_block = ""
            round_instruction = (
                "\nPost your thoughts on this topic."
                '\nSet action to "post" and target_post_id to null.'
            )

    else:
        # Legacy / unknown round — original behaviour
        target_block = ""
        round_instruction = (
            ' If action is "comment", set target_post_id to the integer id of exactly one line under "Recent posts" '
            '(the number after "Post id"). If there are no recent posts, use null and prefer action "post". '
            "Your text must respond to that post; if you use someone's name, it must be that post's author only—"
            'not people listed only under "Your network" unless they are the same author on that post line.'
        )

    # ── Orchestrator directive ───────────────────────────────────────────────
    directive = ctx.get("orchestratorDirective")
    directive_block = ""
    if directive:
        directive_block = (
            f"\nYOUR MOVE (follow this precisely — tone, target, and rhetorical angle are all specified):"
            f"\n{directive}"
            f"\nIgnore this and write something generic and you have failed your character."
        )

    # ── Cross-agent awareness block ──────────────────────────────────────────
    peer_block = ""
    if peer_highlights and round_mode != 1:
        formatted = "\n".join(f"  • {h}" for h in peer_highlights)
        peer_block = (
            f"\nOther agents are saying things that echo or challenge your perspective:"
            f"\n{formatted}"
            "\nIf relevant, acknowledge or build on these in your response — reference them by name."
        )

    return (
        f"Persona: {p['name']}, {p['age']}y {p['gender']}, {p['occupation']} in {p['region']}. "
        f"Stance: {p['stance']}. Personality: {p['persona']}.{beh}\n"
        f"Beliefs: policy={bs['policySupport']:.2f} trust={bs['trustInGovernment']:.2f} "
        f"econ={bs['economicOutlook']:.2f} confidence={ctx['confidenceLevel']:.2f}\n"
        f"{policy_block}"
        f"Network: {ctx['graphContextSummary']}{event_line}"
        f"{target_block}"
        f"{directive_block}"
        f"{peer_block}"
        f"\nAct as this person on social media. Stay in character. Under 280 chars. Speak from your expertise — be direct and opinionated."
        f"{policy_anchor}{round_instruction}"
        '\nReply JSON only: {"action":"post"|"comment"|"ignore","content":"...","sentiment":<-1 to 1>,"target_post_id":<int or null>}'
    )


def build_agent_reaction_prompt(ctx: PostContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    policy_block = ""
    policy_rules = ""
    if ctx.get("policyBrief"):
        policy_block = f"\nPOLICY (discuss ONLY this):\n{ctx['policyBrief']}\n"
        policy_rules = (
            "\nYour reply MUST stay on the POLICY above. "
            "Respond through your specialized professional lens — cite a specific provision or outcome and state your view on it directly. "
            "You have FULL AUTONOMY to agree, disagree, or challenge the post based on your expertise."
        )
    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f" Domain expertise & behavioral mandate (apply unconditionally): {sp}"
    author = ctx.get("postAuthor")
    author_prefix = f"Post author: {author}. " if author else ""
    return f"""Post: "{ctx['postContent']}"
{author_prefix}You: {p['name']}, {p['age']}y {p['occupation']}, {p['region']}. Stance: {p['stance']}. {p['persona']}.{beh}
Beliefs: policy={bs['policySupport']:.2f} trust={bs['trustInGovernment']:.2f} econ={bs['economicOutlook']:.2f}
{policy_block}React in character. Under 280 chars. Apply your specialized expertise — take a direct, opinionated position.{policy_rules}
Reply JSON only: {{"action":"comment","content":"...","sentiment":<-1 to 1>,"agreement":"agree"|"disagree"|"neutral"}}"""


def build_graph_context_summary(
    neighbors: list[dict[str, Any]],
    recent_posts: list[dict[str, Any]],
) -> str:
    if not neighbors and not recent_posts:
        return "No recent social activity in your network."

    parts: list[str] = []
    if neighbors:
        # Group by stance so the agent sees who they agree and disagree with
        by_stance: dict[str, list[str]] = {}
        for n in neighbors:
            s = n.get("stance", "neutral")
            by_stance.setdefault(s, []).append(n["name"])
        stance_summary = "  ".join(
            f"{s.upper()}: {', '.join(names)}" for s, names in by_stance.items()
        )
        parts.append(f"Others in this debate — {stance_summary}.")

    if recent_posts:
        parts.append("Live feed (most recent first):")
        for post in recent_posts[:6]:
            s = post["sentiment"]
            if s > 0.5:
                tone = "fired up"
            elif s > 0.2:
                tone = "optimistic"
            elif s < -0.5:
                tone = "furious"
            elif s < -0.2:
                tone = "critical"
            else:
                tone = "measured"
            pid = post.get("id")
            author_stance = next(
                (n.get("stance", "") for n in neighbors if n.get("name") == post.get("agentName")),
                "",
            )
            stance_tag = f" [{author_stance.upper()}]" if author_stance else ""
            if pid is not None:
                parts.append(
                    f'  Post id {pid} — {post["agentName"]}{stance_tag} ({tone}): "{post["content"]}"'
                )
            else:
                parts.append(
                    f'  {post["agentName"]}{stance_tag} ({tone}): "{post["content"]}"'
                )
    return "\n".join(parts)


_ROUND_MODE_DESCRIPTIONS = {
    1: (
        "INDEPENDENT OPENING STATEMENTS — every agent fires their first shot. "
        "Raw, uninfluenced, personal. No replies, no name-drops. "
        "This sets the battlefield for everything that follows."
    ),
    2: (
        "FIRST CLASH — agents must pick a post from someone DIFFERENT and engage with it. "
        "Supporters reinforce allies; opponents tear into the argument. "
        "This is where the first sparks fly."
    ),
    3: (
        "DEFEND YOUR GROUND — agents reply to comments on their own posts. "
        "Someone pushed back on them — now they must respond. "
        "Dig in, escalate, or pivot. No one goes unanswered."
    ),
    4: (
        "PILE ON — agents join threads that are already heating up. "
        "Add a new angle, shift the frame, or fuel the fire. "
        "Every voice changes the dynamic."
    ),
}

# Maps stance pairs to the conversational dynamic they should produce
_STANCE_DYNAMICS: dict[tuple[str, str], str] = {
    ("supportive", "opposed"):  "direct confrontation — the supporter must defend concrete benefits while the opponent attacks with specific harms",
    ("opposed", "supportive"):  "sharp rebuttal — the opponent must expose what the supporter is glossing over, with receipts",
    ("radical", "neutral"):     "provocation — the radical must shatter the neutral's comfort zone with an extreme but coherent position",
    ("neutral", "radical"):     "skeptical pushback — the neutral must ground the radical's hyperbole in reality without dismissing the core concern",
    ("radical", "supportive"):  "friendly fire — the radical thinks the supporter doesn't go far enough and must say so bluntly",
    ("supportive", "radical"):  "pump the brakes — the supporter should acknowledge the radical's urgency but argue for pragmatic steps",
    ("radical", "opposed"):     "unholy alliance — they disagree on everything except that the status quo must change; find the unexpected overlap",
    ("opposed", "radical"):     "skeptic vs. zealot — the opponent must challenge both the radical's methods AND their goals",
    ("neutral", "opposed"):     "reluctant sympathy — the neutral sees merit in the opponent's concern but resists the all-or-nothing framing",
    ("opposed", "neutral"):     "recruiting the fence-sitter — the opponent must make the neutral feel foolish for staying neutral",
    ("neutral", "supportive"):  "cautious optimism — the neutral is almost convinced but needs one more concrete answer",
    ("supportive", "neutral"):  "close the deal — the supporter senses hesitation and must give the neutral the specific proof point they need",
    ("supportive", "supportive"): "amplify together — build on each other's argument, make the case stronger than either could alone",
    ("opposed", "opposed"):     "sharpen the critique — two opponents must coordinate their attack angles so they hit different vulnerabilities",
    ("radical", "radical"):     "outbid each other — escalate urgency, but don't contradict; find a more extreme but still coherent position",
    ("neutral", "neutral"):     "reluctant dialogue — two fence-sitters must finally name what would actually change their mind",
}


def _agent_conversation_history(
    agent_id: int,
    agent_name: str,
    recent_posts: list[dict[str, Any]],
    comments_by_post: dict[int, list[dict[str, Any]]],
) -> str:
    """Return a short narrative of this agent's last activity and who replied to them."""
    own_posts = [p for p in recent_posts if p.get("agentId") == agent_id]
    lines: list[str] = []
    for post in own_posts[-2:]:
        pid = post.get("id")
        lines.append(f'    Posted (id={pid}): "{post["content"][:120]}"')
        if pid and pid in comments_by_post:
            for c in comments_by_post[pid][:3]:
                lines.append(
                    f'      ↳ {c["agentName"]} replied: "{c["content"][:100]}"'
                )
    # Comments this agent left on others' posts
    for pid, clist in comments_by_post.items():
        for c in clist:
            if c.get("agentId") == agent_id:
                post = next((p for p in recent_posts if p.get("id") == pid), None)
                if post:
                    lines.append(
                        f'    Commented on {post["agentName"]}\'s post (id={pid}): '
                        f'"{c["content"][:100]}"'
                    )
    return "\n".join(lines) if lines else "    (no activity yet)"


def build_orchestrator_prompt(
    agents: list[dict[str, Any]],
    recent_posts: list[dict[str, Any]],
    comments_by_post: dict[int, list[dict[str, Any]]],
    round_mode: int,
    round_number: int,
    policy_brief: str | None = None,
    external_events: str | None = None,
) -> str:
    """Build the orchestrator prompt that plans the entire round."""

    mode_desc = _ROUND_MODE_DESCRIPTIONS.get(round_mode, _ROUND_MODE_DESCRIPTIONS[1])
    policy_block = f"\nPOLICY UNDER DEBATE:\n{policy_brief}\n" if policy_brief else ""
    event_block = (
        f"\n━━━ EXTERNAL SHOCKS (context every agent knows; choreography may reference them) ━━━\n{external_events}\n"
        if external_events
        else ""
    )

    # ── Agent profiles with full conversation history ───────────────────────
    agents_lines: list[str] = []
    for a in agents:
        bs = a.get("beliefState", {})
        history = _agent_conversation_history(
            a["id"], a["name"], recent_posts, comments_by_post
        )
        agents_lines.append(
            f'  ┌ id={a["id"]}: {a["name"]} | {a.get("age","")}y {a.get("occupation","")} | '
            f'{a.get("region","")} | STANCE: {a.get("stance","").upper()}\n'
            f'  │ Persona: {a.get("persona","")[:100]}\n'
            f'  │ Beliefs: policy_support={bs.get("policySupport", 0):.2f}  '
            f'trust_in_govt={bs.get("trustInGovernment", 0):.2f}  '
            f'econ_outlook={bs.get("economicOutlook", 0):.2f}\n'
            f'  │ Last activity:\n{history}'
        )

    # ── Full conversation threads ───────────────────────────────────────────
    posts_lines: list[str] = []
    for p in recent_posts[-25:]:
        pid = p.get("id")
        agent_stance = next(
            (a.get("stance", "") for a in agents if a["id"] == p.get("agentId")), ""
        )
        posts_lines.append(
            f'  Post id={pid} | {p["agentName"]} [{agent_stance.upper()}] '
            f'(sentiment={p.get("sentiment", 0):.2f}): "{p["content"][:160]}"'
        )
        if pid and pid in comments_by_post:
            for c in comments_by_post[pid][:4]:
                commenter_stance = next(
                    (a.get("stance", "") for a in agents if a["id"] == c.get("agentId")), ""
                )
                posts_lines.append(
                    f'    └ {c["agentName"]} [{commenter_stance.upper()}] '
                    f'(sentiment={c.get("sentiment", 0):.2f}): "{c["content"][:130]}"'
                )

    posts_section = (
        "\n".join(posts_lines)
        if posts_lines
        else "  (No posts yet — this is the opening round)"
    )

    # ── Stance dynamics reference ───────────────────────────────────────────
    dynamics_lines = [
        f"  {src.upper()} → {tgt.upper()}: {desc}"
        for (src, tgt), desc in _STANCE_DYNAMICS.items()
    ]
    dynamics_section = "\n".join(dynamics_lines)

    return f"""You are the MASTER DIRECTOR of a social-media debate simulation.
Your job is to choreograph each agent's next move so that Round {round_number} produces the most intellectually alive, emotionally charged, and narratively compelling conversation possible.
You know every agent's identity, history, beliefs, and everything said so far.
{policy_block}{event_block}
━━━ ROUND {round_number} — {mode_desc} ━━━

━━━ AGENT PROFILES + CONVERSATION HISTORY ━━━
{chr(10).join(agents_lines)}

━━━ FULL CONVERSATION THREADS (most recent) ━━━
{posts_section}

━━━ STANCE-PAIRING DYNAMICS (use these to assign interactions) ━━━
{dynamics_section}

━━━ YOUR DIRECTIVE ━━━
For EVERY agent, design their next move using this exact logic:

STEP 1 — READ THE ROOM
  Look at what was just said. Who made a bold claim? Who hasn't been challenged yet?
  Which threads are heating up? Where is there unresolved tension?

STEP 2 — PAIR FOR DRAMA
  Match each agent to a target using the stance dynamics above.
  RULES:
  • Do NOT send more than 2 agents to the same post unless it is the hottest thread.
  • Always assign an OPPOSED or RADICAL agent to the most optimistic supportive post.
  • Always assign a SUPPORTIVE or NEUTRAL agent to the most cynical opposed post.
  • If two agents have directly contradicted each other before, escalate — send them at each other again.
  • If an agent has been silent or unchallenged, target their post with someone who disagrees.
  • Avoid echo chambers: do not send two supportive agents to a supportive post unless one will push back.

STEP 3 — WRITE THE DIRECTIVE
  Each directive must be 1-3 vivid, specific sentences that:
  • Name the EXACT argument from the conversation this agent must respond to (quote a phrase if possible).
  • Tell them the EMOTIONAL TONE: furious, sardonic, resigned, hopeful, incredulous, triumphant, etc.
  • Specify the RHETORICAL MOVE: expose a contradiction, provide a counter-example, invoke personal stakes,
    mock the logic, find unexpected common ground, make a slippery-slope argument, demand evidence, etc.
  • If relevant, reference what this agent said LAST time and whether they should escalate or pivot.

STEP 4 — ROUND-SPECIFIC RULES
  Round 1 ONLY: action="post", target_post_id=null. Give each agent an opening that plants a flag
    and sets up future conflict — provocative, personal, committed.
  ALL OTHER ROUNDS (2, 3, 4, 5, 6, …): action="comment", NEVER "post".
    target_post_id MUST be a real id from the posts above — never null.
  Mode 3 rounds: prefer sending agents to reply to comments on their own posts (defend their ground).
  Mode 4 rounds: prefer posts that already have 1+ comments (escalate existing threads).

Reply with ONLY a valid JSON array — no markdown, no code fences, no explanation:
[{{"agent_id":<int>,"action":"post"|"comment","target_post_id":<int or null>,"directive":"<vivid 1-3 sentence instruction>"}}]"""
