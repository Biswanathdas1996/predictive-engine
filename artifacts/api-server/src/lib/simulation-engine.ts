import { db, agentsTable, postsTable, influencesTable, beliefSnapshotsTable, simulationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

interface BeliefState {
  policySupport: number;
  trustInGovernment: number;
  economicOutlook: number;
}

interface AgentRow {
  id: number;
  name: string;
  beliefState: BeliefState;
  confidenceLevel: number;
  influenceScore: number;
  credibilityScore: number;
  activityLevel: number;
  stance: string;
  persona: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function updateBelief(
  agent: { beliefState: BeliefState; confidenceLevel: number },
  incomingSignal: number,
  influenceWeight: number,
  learningRate: number = 0.3
): { beliefState: BeliefState; confidenceLevel: number } {
  const delta = learningRate * influenceWeight * (incomingSignal - agent.beliefState.policySupport);

  const newPolicySupport = clamp(agent.beliefState.policySupport + delta, -1, 1);
  const newConfidence = clamp(agent.confidenceLevel + Math.abs(delta) * 0.1, 0, 1);

  const trustDelta = learningRate * influenceWeight * 0.3 * (incomingSignal > 0 ? 0.1 : -0.1);
  const newTrust = clamp(agent.beliefState.trustInGovernment + trustDelta, -1, 1);

  const econDelta = learningRate * influenceWeight * 0.2 * incomingSignal;
  const newEcon = clamp(agent.beliefState.economicOutlook + econDelta, -1, 1);

  return {
    beliefState: {
      policySupport: newPolicySupport,
      trustInGovernment: newTrust,
      economicOutlook: newEcon,
    },
    confidenceLevel: newConfidence,
  };
}

function generateAgentAction(agent: AgentRow, round: number): {
  action: "post" | "comment" | "ignore";
  content: string;
  sentiment: number;
} {
  const activityRoll = Math.random();
  if (activityRoll > agent.activityLevel) {
    return { action: "ignore", content: "", sentiment: 0 };
  }

  const bs = agent.beliefState as BeliefState;
  const sentiment = clamp(
    bs.policySupport * 0.6 + bs.economicOutlook * 0.2 + (Math.random() - 0.5) * 0.4,
    -1,
    1
  );

  const stanceTexts: Record<string, string[]> = {
    supportive: [
      "This policy direction shows real promise. We need more initiatives like this.",
      "I believe the current approach is heading in the right direction for our community.",
      "The data supports what we've been saying - this policy works.",
      "As someone in the field, I can confirm the positive impact of these measures.",
    ],
    opposed: [
      "We need to seriously reconsider this approach. The evidence doesn't support it.",
      "From my experience, this policy is creating more problems than it solves.",
      "The costs outweigh the benefits here. We need alternatives.",
      "I'm concerned about the long-term consequences of this direction.",
    ],
    neutral: [
      "There are valid points on both sides of this discussion.",
      "I think we need more data before drawing conclusions.",
      "The situation is more nuanced than most people realize.",
      "I'm still evaluating the evidence on this policy.",
    ],
    radical: [
      "The entire system needs fundamental restructuring, not half-measures.",
      "We cannot keep applying band-aid solutions to systemic problems.",
      "Bold action is required - incremental change won't cut it anymore.",
      "The status quo is unsustainable. We need revolutionary thinking.",
    ],
  };

  const texts = stanceTexts[agent.stance] || stanceTexts["neutral"];
  const content = texts[Math.floor(Math.random() * texts.length)];

  return {
    action: Math.random() > 0.3 ? "post" : "comment",
    content: `[${agent.name}, Round ${round}] ${content}`,
    sentiment,
  };
}

export async function runSimulationRound(simulationId: number) {
  const [simulation] = await db
    .select()
    .from(simulationsTable)
    .where(eq(simulationsTable.id, simulationId));

  if (!simulation) {
    throw new Error("Simulation not found");
  }

  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, simulationId));

  if (agents.length === 0) {
    throw new Error("No agents in this simulation");
  }

  const influences = await db.select().from(influencesTable);

  const newRound = simulation.currentRound + 1;
  const config = simulation.config as { learningRate?: number };
  const learningRate = config.learningRate || 0.3;

  const agentStates: Array<{
    agentId: number;
    name: string;
    policySupport: number;
    confidenceLevel: number;
    action: string;
    sentiment: number;
  }> = [];

  let totalSentiment = 0;
  let totalPolicySupport = 0;
  let postsGenerated = 0;
  let beliefsUpdated = 0;

  for (const agent of agents) {
    const bs = agent.beliefState as BeliefState;
    const agentRow: AgentRow = {
      id: agent.id,
      name: agent.name,
      beliefState: bs,
      confidenceLevel: agent.confidenceLevel,
      influenceScore: agent.influenceScore,
      credibilityScore: agent.credibilityScore,
      activityLevel: agent.activityLevel,
      stance: agent.stance,
      persona: agent.persona,
    };

    const incomingInfluences = influences.filter((inf) => inf.targetAgentId === agent.id);
    for (const inf of incomingInfluences) {
      const sourceAgent = agents.find((a) => a.id === inf.sourceAgentId);
      if (sourceAgent) {
        const sourceBs = sourceAgent.beliefState as BeliefState;
        const updated = updateBelief(
          { beliefState: agentRow.beliefState, confidenceLevel: agentRow.confidenceLevel },
          sourceBs.policySupport,
          inf.weight * sourceAgent.credibilityScore,
          learningRate
        );
        agentRow.beliefState = updated.beliefState;
        agentRow.confidenceLevel = updated.confidenceLevel;
        beliefsUpdated++;
      }
    }

    const { action, content, sentiment } = generateAgentAction(agentRow, newRound);

    if (action !== "ignore" && content) {
      const tags = [];
      if (sentiment > 0.3) tags.push("positive");
      if (sentiment < -0.3) tags.push("negative");
      tags.push("policy-discussion");

      await db.insert(postsTable).values({
        content,
        sentiment,
        platform: "simulation",
        topicTags: tags,
        round: newRound,
        agentId: agent.id,
        simulationId,
      });
      postsGenerated++;
    }

    await db
      .update(agentsTable)
      .set({
        beliefState: agentRow.beliefState,
        confidenceLevel: agentRow.confidenceLevel,
      })
      .where(eq(agentsTable.id, agent.id));

    totalSentiment += sentiment;
    totalPolicySupport += agentRow.beliefState.policySupport;

    agentStates.push({
      agentId: agent.id,
      name: agent.name,
      policySupport: agentRow.beliefState.policySupport,
      confidenceLevel: agentRow.confidenceLevel,
      action,
      sentiment,
    });
  }

  const avgTrust =
    agents.reduce((sum, a) => sum + ((a.beliefState as BeliefState).trustInGovernment || 0.5), 0) /
    agents.length;
  const avgEcon =
    agents.reduce((sum, a) => sum + ((a.beliefState as BeliefState).economicOutlook || 0.5), 0) /
    agents.length;

  await db.insert(beliefSnapshotsTable).values({
    simulationId,
    round: newRound,
    averagePolicySupport: totalPolicySupport / agents.length,
    averageTrustInGovernment: avgTrust,
    averageEconomicOutlook: avgEcon,
  });

  await db
    .update(simulationsTable)
    .set({
      currentRound: newRound,
      status: "running",
    })
    .where(eq(simulationsTable.id, simulationId));

  return {
    round: newRound,
    postsGenerated,
    beliefsUpdated,
    averageSentiment: agents.length > 0 ? totalSentiment / agents.length : 0,
    averagePolicySupport: agents.length > 0 ? totalPolicySupport / agents.length : 0,
    agentStates,
  };
}

export async function runMonteCarlo(
  simulationId: number,
  numRuns: number,
  roundsPerRun: number
) {
  const [simulation] = await db
    .select()
    .from(simulationsTable)
    .where(eq(simulationsTable.id, simulationId));

  if (!simulation) {
    throw new Error("Simulation not found");
  }

  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, simulationId));

  const influences = await db.select().from(influencesTable);

  const config = simulation.config as { learningRate?: number };
  const learningRate = config.learningRate || 0.3;

  const results: Array<{
    runIndex: number;
    policySupport: number;
    publicSentiment: number;
    engagement: number;
    seed: number;
  }> = [];

  for (let run = 0; run < numRuns; run++) {
    const seed = Math.floor(Math.random() * 1000000);

    const agentCopies = agents.map((a) => ({
      ...a,
      beliefState: { ...(a.beliefState as BeliefState) },
      confidenceLevel: a.confidenceLevel,
    }));

    let totalSentiment = 0;
    let totalEngagement = 0;

    for (let round = 0; round < roundsPerRun; round++) {
      for (const agent of agentCopies) {
        const incomingInfluences = influences.filter(
          (inf) => inf.targetAgentId === agent.id
        );

        for (const inf of incomingInfluences) {
          const sourceAgent = agentCopies.find((a) => a.id === inf.sourceAgentId);
          if (sourceAgent) {
            const updated = updateBelief(
              { beliefState: agent.beliefState, confidenceLevel: agent.confidenceLevel },
              sourceAgent.beliefState.policySupport,
              inf.weight * (sourceAgent.credibilityScore || 0.5),
              learningRate
            );
            agent.beliefState = updated.beliefState;
            agent.confidenceLevel = updated.confidenceLevel;
          }
        }

        const noise = (Math.random() - 0.5) * 0.2;
        totalSentiment += agent.beliefState.policySupport + noise;
        if (Math.random() < (agent.activityLevel || 0.5)) {
          totalEngagement++;
        }
      }
    }

    const avgSupport =
      agentCopies.reduce((sum, a) => sum + a.beliefState.policySupport, 0) / agentCopies.length;

    results.push({
      runIndex: run,
      policySupport: avgSupport,
      publicSentiment: totalSentiment / (agentCopies.length * roundsPerRun),
      engagement: totalEngagement,
      seed,
    });
  }

  const supportScores = results.map((r) => r.policySupport);
  const mean = supportScores.reduce((a, b) => a + b, 0) / supportScores.length;
  const variance =
    supportScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (supportScores.length - 1 || 1);
  const stdDev = Math.sqrt(variance);

  const sorted = [...supportScores].sort((a, b) => a - b);
  const ci95Lower = sorted[Math.floor(sorted.length * 0.025)] || mean - 1.96 * stdDev;
  const ci95Upper = sorted[Math.floor(sorted.length * 0.975)] || mean + 1.96 * stdDev;

  return {
    meanSupport: mean,
    variance,
    min: Math.min(...supportScores),
    max: Math.max(...supportScores),
    confidenceInterval: [ci95Lower, ci95Upper],
    distribution: results,
  };
}
