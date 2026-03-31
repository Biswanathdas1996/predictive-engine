"""Layman narrative for the belief evolution chart via PwC GenAI."""

from __future__ import annotations

import json
from typing import Any

from app.services.llm_service import call_pwc_genai_async


async def decode_belief_chart_report(
    *,
    simulation_name: str,
    simulation_description: str,
    current_round: int,
    series: list[dict[str, Any]],
) -> str:
    payload = json.dumps(series, indent=2)
    prompt = f"""You write for business executives and program leads who are not statisticians.

Simulation name: {simulation_name}
Simulation description: {simulation_description or "(none)"}
Latest completed round (index): {current_round}

Chart data — each row is one simulation round:
- round: step index
- support: modeled policy support (−1 strong opposition, +1 strong support)
- sentiment: modeled public mood (−1 very negative, +1 very positive)

JSON array:
{payload}

Task: Write a concise narrative (4–7 sentences) in plain business English.
- Explain what the two measures mean for decision-makers.
- Describe how support and sentiment evolved relative to each other (aligned, diverging, volatile, stable).
- End with what the latest step suggests for stakeholder posture and communication, without quoting raw numbers (use words like moderate, building, softening, split, cautious).

If the pattern looks like smooth or synthetic demo data, mention briefly that the series may be illustrative until live belief data is recorded—still interpret the shape.

Rules: no bullet lists, no markdown headings, no JSON, no table."""

    raw = (
        await call_pwc_genai_async(
            prompt,
            task_name="belief_chart_decode",
            temperature=0.35,
            max_tokens=600,
        )
    ).strip()
    if not raw:
        raise ValueError("empty GenAI response")
    return raw[:12_000]
