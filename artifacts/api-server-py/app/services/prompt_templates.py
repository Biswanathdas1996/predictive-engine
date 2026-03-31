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
    conversationHistory: str               # this agent's own prior posts and replies received


class PostContext(TypedDict, total=False):
    postContent: str
    postAuthor: str
    persona: AgentPersona
    beliefState: BeliefState
    policyBrief: str
    event: str
    graphContextSummary: str
    conversationHistory: str


def build_agent_action_prompt(ctx: AgentContext) -> str:
    p = ctx["persona"]
    bs = ctx["beliefState"]
    event_line = f"\nExternal event: {ctx['event']}" if ctx.get("event") else ""

    policy_block = ""
    policy_anchor = ""
    if ctx.get("policyBrief"):
        policy_block = f"\nPOLICY (discuss ONLY this — no other topics):\n{ctx['policyBrief']}\n"
        occupation = p.get("occupation", "professional")
        policy_anchor = (
            "\nYou MUST write only about the POLICY above — no other topics. "
            f"As a {occupation}, focus on the provisions and outcomes most relevant to your field and daily experience. "
            "Different people notice different parts of the same policy — you should naturally gravitate toward "
            "what affects YOUR work, YOUR community, or YOUR livelihood. "
            "State your view directly based on what you know professionally."
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

    # ── Agent's own conversation history ───────────────────────────────────
    history_block = ""
    conv_history = ctx.get("conversationHistory")
    if conv_history and round_mode != 1:
        history_block = (
            f"\nYOUR RECENT ACTIVITY (what you said and who replied — stay consistent with your prior positions):"
            f"\n{conv_history}"
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
        f"{history_block}"
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
        occupation = p.get("occupation", "professional")
        policy_rules = (
            "\nYour reply MUST stay on the POLICY above. "
            f"As a {occupation}, focus on the aspects most relevant to your work and lived experience. "
            "Respond through your professional lens — cite what this policy means for your domain specifically. "
            "You have FULL AUTONOMY to agree, disagree, or challenge the post based on your expertise."
        )
    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f" Domain expertise & behavioral mandate (apply unconditionally): {sp}"
    author = ctx.get("postAuthor")
    author_prefix = f"Post author: {author}. " if author else ""
    event_line = f"\nExternal event context: {ctx['event']}" if ctx.get("event") else ""
    network_line = f"\nNetwork: {ctx['graphContextSummary']}" if ctx.get("graphContextSummary") else ""
    history_block = ""
    if ctx.get("conversationHistory"):
        history_block = f"\nYour recent activity (stay consistent):\n{ctx['conversationHistory']}"
    return f"""Post: "{ctx['postContent']}"
{author_prefix}You: {p['name']}, {p['age']}y {p['occupation']}, {p['region']}. Stance: {p['stance']}. {p['persona']}.{beh}
Beliefs: policy={bs['policySupport']:.2f} trust={bs['trustInGovernment']:.2f} econ={bs['economicOutlook']:.2f}{event_line}{network_line}{history_block}
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
        parts.append("Live feed (most recent first — pay more attention to recent posts):")
        total = min(len(recent_posts), 8)
        for idx, post in enumerate(recent_posts[:8]):
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
            # Recency label: recent posts get more attention weight
            if idx < total * 0.3:
                recency = "just now"
            elif idx < total * 0.6:
                recency = "recent"
            else:
                recency = "earlier"
            pid = post.get("id")
            author_stance = next(
                (n.get("stance", "") for n in neighbors if n.get("name") == post.get("agentName")),
                "",
            )
            stance_tag = f" [{author_stance.upper()}]" if author_stance else ""
            if pid is not None:
                parts.append(
                    f'  Post id {pid} [{recency}] — {post["agentName"]}{stance_tag} ({tone}): "{post["content"]}"'
                )
            else:
                parts.append(
                    f'  [{recency}] {post["agentName"]}{stance_tag} ({tone}): "{post["content"]}"'
                )
    return "\n".join(parts)


_ROUND_MODE_DESCRIPTIONS = {
    1: (
        "OPENING STATEMENTS — each agent shares their initial, uninfluenced perspective. "
        "No replies, no name-drops. Personal, grounded in their background and expertise. "
        "Some agents will be passionate, others measured — match their personality."
    ),
    2: (
        "INITIAL RESPONSES — agents pick a post from someone DIFFERENT and engage with it. "
        "Reactions should be natural: some agree and build on the idea, some push back, "
        "some ask clarifying questions, some partially agree with caveats. "
        "Not every interaction needs to be a confrontation."
    ),
    3: (
        "FOLLOW-UP — agents reply to comments on their own posts. "
        "Responses vary naturally: some defend their position, some concede a point, "
        "some clarify a misunderstanding, some pivot to a related concern. "
        "People don't always escalate — sometimes they find common ground."
    ),
    4: (
        "BROADER DISCUSSION — agents join threads that have attracted attention. "
        "Add a new angle, share a relevant experience, or synthesize what others have said. "
        "Some agents may lose interest and disengage. Not every thread needs more voices."
    ),
}

# Maps stance pairs to the natural conversational dynamic they tend to produce
_STANCE_DYNAMICS: dict[tuple[str, str], str] = {
    ("supportive", "opposed"):  "genuine disagreement — the supporter explains concrete benefits from their experience; the opponent raises specific concerns. Both may find partial overlap",
    ("opposed", "supportive"):  "substantive pushback — the opponent highlights what they see as overlooked costs or risks, grounded in their expertise",
    ("radical", "neutral"):     "challenge to complacency — the radical pushes the neutral to take a clearer position; the neutral may ask for evidence or express discomfort",
    ("neutral", "radical"):     "measured skepticism — the neutral acknowledges the urgency but questions whether the proposed approach is realistic",
    ("radical", "supportive"):  "tension within allies — the radical feels the supporter's position doesn't go far enough; the tone ranges from frustrated to collaborative",
    ("supportive", "radical"):  "pragmatic bridge-building — the supporter shares the radical's goal but argues for incremental, achievable steps",
    ("radical", "opposed"):     "unexpected common ground — despite different conclusions, both may agree the current situation is broken; explore where they diverge",
    ("opposed", "radical"):     "deep skepticism — the opponent questions both the radical's diagnosis and their proposed solution, seeking specifics",
    ("neutral", "opposed"):     "careful consideration — the neutral finds some merit in the opposition's concerns but isn't ready to commit to that position",
    ("opposed", "neutral"):     "persuasion attempt — the opponent tries to show the neutral why sitting on the fence isn't viable, using concrete examples",
    ("neutral", "supportive"):  "almost convinced — the neutral sees promise but needs one more specific answer or assurance before committing",
    ("supportive", "neutral"):  "gentle persuasion — the supporter offers their strongest evidence or personal experience to address the neutral's hesitation",
    ("supportive", "supportive"): "mutual reinforcement — they build on each other's points, though they may emphasize different aspects or priorities",
    ("opposed", "opposed"):     "shared concerns, different angles — two critics may highlight different weaknesses, strengthening the overall critique",
    ("radical", "radical"):     "escalating urgency — they validate each other's frustration and may push toward bolder proposals, but risk groupthink",
    ("neutral", "neutral"):     "exploratory dialogue — two undecided people compare notes on what information would change their minds",
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

    return f"""You are the COORDINATOR of a realistic social-media policy discussion simulation.
Your job is to guide each agent's next move so that Round {round_number} produces authentic, varied conversation that mirrors how real people discuss policy online.
You know every agent's identity, history, beliefs, and everything said so far.

REALISM PRINCIPLES:
- Not every interaction is a confrontation. Real discourse includes agreement, partial agreement, questions, topic drift, and disengagement.
- People with similar views still have different priorities and emphasis.
- Some agents may lose interest, repeat themselves, or go off on tangents — this is natural.
- Emotional intensity varies: some people stay measured throughout, others get heated only on specific points.
- People reference their own prior statements and build on them over time.
- Persuasion is gradual — sudden opinion changes are rare. Conceding a small point is more realistic than full capitulation.
{policy_block}{event_block}
━━━ ROUND {round_number} — {mode_desc} ━━━

━━━ AGENT PROFILES + CONVERSATION HISTORY ━━━
{chr(10).join(agents_lines)}

━━━ FULL CONVERSATION THREADS (most recent) ━━━
{posts_section}

━━━ STANCE-PAIRING DYNAMICS (use these to guide interactions) ━━━
{dynamics_section}

━━━ YOUR DIRECTIVE ━━━
For EVERY agent, design their next move using this logic:

STEP 1 — READ THE ROOM
  Look at what was just said. What claims are unaddressed? Where is there genuine tension or agreement?
  Which threads have momentum? Are there agents who haven't been heard from?

STEP 2 — PAIR NATURALLY
  Match each agent to a target using the stance dynamics above as guidance (not rigid rules).
  GUIDELINES:
  • Do NOT send more than 2 agents to the same post unless it's a genuinely central thread.
  • Ensure opposing views get a response, but also allow allies to build on each other's points.
  • If two agents have been debating, they may continue OR one may disengage — vary the pattern.
  • If an agent has been quiet, they might chime in now — or stay quiet. Match their personality.
  • Allow some echo-chamber behavior (it's realistic) but ensure the overall round has cross-stance interaction.
  • ~20-30% of interactions should involve agreement, partial agreement, or asking questions rather than disagreement.

STEP 3 — WRITE THE DIRECTIVE
  Each directive must be 1-3 specific sentences that:
  • Name the EXACT argument or point from the conversation this agent should respond to.
  • Suggest a NATURAL TONE that fits their personality: concerned, analytical, frustrated, hopeful, confused, confident, conciliatory, etc.
  • Suggest the RHETORICAL APPROACH: share personal experience, cite their professional expertise, ask a probing question,
    concede a point while raising another, offer a real-world example, express genuine uncertainty, build on an ally's argument, etc.
  • If relevant, reference what this agent said before and whether they should stay consistent, evolve slightly, or address a new angle.

STEP 4 — ROUND-SPECIFIC RULES
  Round 1 ONLY: action="post", target_post_id=null. Each agent shares their initial perspective —
    some will be passionate, others cautious. Match their personality.
  ALL OTHER ROUNDS (2, 3, 4, 5, 6, …): action="comment", NEVER "post".
    target_post_id MUST be a real id from the posts above — never null.
  Mode 3 rounds: prefer sending agents to reply to comments on their own posts.
  Mode 4 rounds: prefer posts that already have 1+ comments (join existing discussions).

Reply with ONLY a valid JSON array — no markdown, no code fences, no explanation:
[{{"agent_id":<int>,"action":"post"|"comment","target_post_id":<int or null>,"directive":"<specific 1-3 sentence instruction>"}}]"""


def build_user_thread_reply_prompt(
    *,
    post_content: str,
    post_author_name: str,
    user_comment: str,
    persona: dict[str, Any],
    belief_state: dict[str, Any],
    policy_brief: str | None = None,
    event_line: str | None = None,
) -> str:
    """Prompt for a simulated agent who MUST reply on-thread to a human facilitator comment."""
    p = persona
    bs = belief_state
    policy_block = f"\nPOLICY CONTEXT (stay on topic):\n{policy_brief}\n" if policy_brief else ""
    event_block = f"\nExternal event context: {event_line}\n" if event_line else ""
    beh = ""
    sp = p.get("systemPrompt")
    if sp:
        beh = f" Domain expertise (apply): {sp}"
    return f"""You are {p["name"]}, {p["age"]}y, {p["occupation"]} in {p["region"]}. Stance: {p["stance"]}. {p["persona"]}.{beh}
Beliefs: policy={bs["policySupport"]:.2f} trust={bs["trustInGovernment"]:.2f} econ={bs["economicOutlook"]:.2f}
{policy_block}{event_block}
THREAD — Original post by {post_author_name}:
"{post_content}"

A human facilitator (labeled "You" in the UI) just replied on this same thread:
"{user_comment}"

You MUST respond directly to what the facilitator said — agree, disagree, clarify, or ask a follow-up — in character.
Stay under 280 characters. This is a comment on the SAME post (thread), not a new top-level post.

Reply JSON only: {{"action":"comment","content":"...","sentiment":<-1 to 1>}}"""
