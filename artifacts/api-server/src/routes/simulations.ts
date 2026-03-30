import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  simulationsTable,
  agentsTable,
  postsTable,
  beliefSnapshotsTable,
  monteCarloRunsTable,
} from "@workspace/db";
import {
  ListSimulationsResponse,
  CreateSimulationBody,
  GetSimulationParams,
  GetSimulationResponse,
  DeleteSimulationParams,
  RunSimulationRoundParams,
  RunSimulationRoundResponse,
  GetSimulationPostsParams,
  GetSimulationPostsQueryParams,
  GetSimulationPostsResponse,
  RunMonteCarloParams,
  RunMonteCarloBody,
  RunMonteCarloResponse,
  GetMonteCarloRunsParams,
  GetMonteCarloRunsResponse,
  GetSimulationReportParams,
  GetSimulationReportResponse,
} from "@workspace/api-zod";
import { runSimulationRound, runMonteCarlo } from "../lib/simulation-engine";

const router: IRouter = Router();

router.get("/simulations", async (_req, res): Promise<void> => {
  const simulations = await db
    .select()
    .from(simulationsTable)
    .orderBy(desc(simulationsTable.createdAt));

  const enriched = await Promise.all(
    simulations.map(async (sim) => {
      const [agentCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentsTable)
        .where(eq(agentsTable.simulationId, sim.id));

      const [postCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postsTable)
        .where(eq(postsTable.simulationId, sim.id));

      return {
        ...sim,
        totalAgents: agentCount?.count || 0,
        totalPosts: postCount?.count || 0,
        config: sim.config as {
          learningRate: number;
          numRounds: number;
          agentCount: number;
          policyId?: number | null;
        },
      };
    })
  );

  res.json(ListSimulationsResponse.parse(enriched));
});

router.post("/simulations", async (req, res): Promise<void> => {
  const parsed = CreateSimulationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [sim] = await db
    .insert(simulationsTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description,
      config: parsed.data.config,
    })
    .returning();

  const config = parsed.data.config;
  const agentCount = config.agentCount || 10;
  const personas = [
    { name: "Sarah Chen", age: 34, gender: "female", region: "Urban", occupation: "Software Engineer", persona: "Tech-savvy urban professional concerned about economic growth", stance: "supportive" },
    { name: "Marcus Johnson", age: 52, gender: "male", region: "Suburban", occupation: "Small Business Owner", persona: "Conservative business owner focused on tax policy", stance: "opposed" },
    { name: "Elena Rodriguez", age: 28, gender: "female", region: "Urban", occupation: "Social Worker", persona: "Progressive advocate for social justice and equity", stance: "supportive" },
    { name: "Robert Williams", age: 67, gender: "male", region: "Rural", occupation: "Retired Teacher", persona: "Moderate with traditional values and education focus", stance: "neutral" },
    { name: "Aisha Patel", age: 41, gender: "female", region: "Suburban", occupation: "Healthcare Worker", persona: "Healthcare professional concerned about public health policy", stance: "supportive" },
    { name: "James Thompson", age: 45, gender: "male", region: "Rural", occupation: "Farmer", persona: "Agricultural worker focused on environmental regulations", stance: "opposed" },
    { name: "Lisa Wang", age: 31, gender: "female", region: "Urban", occupation: "Journalist", persona: "Media professional seeking balanced perspectives", stance: "neutral" },
    { name: "David Kumar", age: 38, gender: "male", region: "Urban", occupation: "University Professor", persona: "Academic with evidence-based policy preferences", stance: "neutral" },
    { name: "Maria Garcia", age: 55, gender: "female", region: "Suburban", occupation: "Nurse", persona: "Experienced healthcare worker with union ties", stance: "supportive" },
    { name: "Tom Anderson", age: 23, gender: "male", region: "Urban", occupation: "Student", persona: "Young activist with radical policy reform views", stance: "radical" },
    { name: "Karen White", age: 49, gender: "female", region: "Suburban", occupation: "Accountant", persona: "Fiscal conservative focused on government spending", stance: "opposed" },
    { name: "Michael Brown", age: 60, gender: "male", region: "Rural", occupation: "Factory Worker", persona: "Blue collar worker concerned about job security", stance: "neutral" },
  ];

  const agentsToCreate = [];
  for (let i = 0; i < agentCount; i++) {
    const template = personas[i % personas.length];
    agentsToCreate.push({
      ...template,
      name: i < personas.length ? template.name : `${template.name} ${Math.floor(i / personas.length) + 1}`,
      influenceScore: 0.3 + Math.random() * 0.5,
      credibilityScore: 0.4 + Math.random() * 0.4,
      beliefState: {
        policySupport: (Math.random() - 0.5) * 1.6,
        trustInGovernment: Math.random() * 0.8 + 0.1,
        economicOutlook: (Math.random() - 0.5) * 1.4,
      },
      confidenceLevel: 0.3 + Math.random() * 0.5,
      activityLevel: 0.3 + Math.random() * 0.5,
      simulationId: sim.id,
    });
  }

  const createdAgents = await db.insert(agentsTable).values(agentsToCreate).returning();

  for (let i = 0; i < createdAgents.length; i++) {
    const numConnections = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < numConnections; j++) {
      let targetIdx = Math.floor(Math.random() * createdAgents.length);
      if (targetIdx === i) targetIdx = (targetIdx + 1) % createdAgents.length;

      await db.insert((await import("@workspace/db")).influencesTable).values({
        sourceAgentId: createdAgents[i].id,
        targetAgentId: createdAgents[targetIdx].id,
        weight: 0.2 + Math.random() * 0.6,
      });
    }
  }

  const [agentCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, sim.id));

  res.status(201).json(
    GetSimulationResponse.parse({
      ...sim,
      totalAgents: agentCountResult?.count || 0,
      totalPosts: 0,
      config: sim.config as {
        learningRate: number;
        numRounds: number;
        agentCount: number;
        policyId?: number | null;
      },
    })
  );
});

router.get("/simulations/:id", async (req, res): Promise<void> => {
  const params = GetSimulationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sim] = await db
    .select()
    .from(simulationsTable)
    .where(eq(simulationsTable.id, params.data.id));

  if (!sim) {
    res.status(404).json({ error: "Simulation not found" });
    return;
  }

  const [agentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, sim.id));

  const [postCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable)
    .where(eq(postsTable.simulationId, sim.id));

  res.json(
    GetSimulationResponse.parse({
      ...sim,
      totalAgents: agentCount?.count || 0,
      totalPosts: postCount?.count || 0,
      config: sim.config as {
        learningRate: number;
        numRounds: number;
        agentCount: number;
        policyId?: number | null;
      },
    })
  );
});

router.delete("/simulations/:id", async (req, res): Promise<void> => {
  const params = DeleteSimulationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(postsTable).where(eq(postsTable.simulationId, params.data.id));
  await db.delete(beliefSnapshotsTable).where(eq(beliefSnapshotsTable.simulationId, params.data.id));
  await db.delete(monteCarloRunsTable).where(eq(monteCarloRunsTable.simulationId, params.data.id));

  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, params.data.id));

  const agentIds = agents.map((a) => a.id);
  if (agentIds.length > 0) {
    for (const agentId of agentIds) {
      await db.delete((await import("@workspace/db")).influencesTable).where(
        eq((await import("@workspace/db")).influencesTable.sourceAgentId, agentId)
      );
      await db.delete((await import("@workspace/db")).influencesTable).where(
        eq((await import("@workspace/db")).influencesTable.targetAgentId, agentId)
      );
    }
  }

  await db.delete(agentsTable).where(eq(agentsTable.simulationId, params.data.id));

  const [sim] = await db
    .delete(simulationsTable)
    .where(eq(simulationsTable.id, params.data.id))
    .returning();

  if (!sim) {
    res.status(404).json({ error: "Simulation not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/simulations/:id/run", async (req, res): Promise<void> => {
  const params = RunSimulationRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const result = await runSimulationRound(params.data.id);
  res.json(RunSimulationRoundResponse.parse(result));
});

router.get("/simulations/:id/posts", async (req, res): Promise<void> => {
  const params = GetSimulationPostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetSimulationPostsQueryParams.safeParse(req.query);
  const limit = query.success ? query.data.limit ?? 50 : 50;

  const posts = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.simulationId, params.data.id))
    .orderBy(desc(postsTable.createdAt))
    .limit(limit);

  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, params.data.id));

  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  const postsWithNames = posts.map((p) => ({
    ...p,
    agentName: agentMap.get(p.agentId) || "Unknown",
  }));

  res.json(GetSimulationPostsResponse.parse(postsWithNames));
});

router.post("/montecarlo/:simulationId", async (req, res): Promise<void> => {
  const params = RunMonteCarloParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = RunMonteCarloBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await runMonteCarlo(
    params.data.simulationId,
    body.data.numRuns,
    body.data.roundsPerRun
  );

  await db.insert(monteCarloRunsTable).values({
    simulationId: params.data.simulationId,
    numRuns: body.data.numRuns,
    meanSupport: result.meanSupport,
    variance: result.variance,
    minSupport: result.min,
    maxSupport: result.max,
    distribution: result.distribution,
  });

  res.json(RunMonteCarloResponse.parse(result));
});

router.get("/montecarlo/:simulationId/runs", async (req, res): Promise<void> => {
  const params = GetMonteCarloRunsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const runs = await db
    .select()
    .from(monteCarloRunsTable)
    .where(eq(monteCarloRunsTable.simulationId, params.data.simulationId))
    .orderBy(desc(monteCarloRunsTable.createdAt));

  res.json(GetMonteCarloRunsResponse.parse(runs));
});

router.get("/reports/:simulationId", async (req, res): Promise<void> => {
  const params = GetSimulationReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sim] = await db
    .select()
    .from(simulationsTable)
    .where(eq(simulationsTable.id, params.data.simulationId));

  if (!sim) {
    res.status(404).json({ error: "Simulation not found" });
    return;
  }

  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.simulationId, params.data.simulationId));

  const snapshots = await db
    .select()
    .from(beliefSnapshotsTable)
    .where(eq(beliefSnapshotsTable.simulationId, params.data.simulationId))
    .orderBy(beliefSnapshotsTable.round);

  const [latestMC] = await db
    .select()
    .from(monteCarloRunsTable)
    .where(eq(monteCarloRunsTable.simulationId, params.data.simulationId))
    .orderBy(desc(monteCarloRunsTable.createdAt))
    .limit(1);

  const sortedAgents = [...agents].sort((a, b) => b.influenceScore - a.influenceScore);

  const avgSupport =
    agents.length > 0
      ? agents.reduce(
          (sum, a) =>
            sum + ((a.beliefState as { policySupport: number }).policySupport || 0),
          0
        ) / agents.length
      : 0;

  const supportive = agents.filter(
    (a) => ((a.beliefState as { policySupport: number }).policySupport || 0) > 0.3
  ).length;
  const opposed = agents.filter(
    (a) => ((a.beliefState as { policySupport: number }).policySupport || 0) < -0.3
  ).length;

  const keyOutcomes = [
    {
      label: "Policy adoption likelihood",
      probability: Math.max(0, Math.min(1, (avgSupport + 1) / 2)),
      impact: avgSupport > 0.3 ? "high" : avgSupport > 0 ? "medium" : "low",
    },
    {
      label: "Public consensus reached",
      probability: Math.max(0, 1 - Math.abs(supportive - opposed) / (agents.length || 1)),
      impact: "medium",
    },
    {
      label: "Social polarization risk",
      probability: Math.min(1, (supportive + opposed) / (agents.length || 1)),
      impact: supportive + opposed > agents.length * 0.7 ? "high" : "low",
    },
  ];

  const riskFactors = [];
  if (avgSupport < -0.3) riskFactors.push("Strong opposition to policy detected");
  if (supportive + opposed > agents.length * 0.7) riskFactors.push("High polarization among agents");
  if (agents.length < 5) riskFactors.push("Low sample size may affect prediction accuracy");
  if (sim.currentRound < 3) riskFactors.push("Insufficient simulation rounds for convergence");
  riskFactors.push("External events may significantly alter outcomes");

  const causalDrivers = [
    "Agent influence network topology",
    "Initial belief state distribution",
    "Learning rate and signal propagation",
    "Activity level and engagement patterns",
    "Source credibility weighting",
  ];

  const report = {
    simulationId: sim.id,
    simulationName: sim.name,
    generatedAt: new Date().toISOString(),
    keyOutcomes,
    riskFactors,
    influentialAgents: sortedAgents.slice(0, 5).map((a) => ({
      agentId: a.id,
      name: a.name,
      influenceScore: a.influenceScore,
      stance: a.stance,
    })),
    causalDrivers,
    monteCarloSummary: latestMC
      ? {
          totalRuns: latestMC.numRuns,
          meanSupport: latestMC.meanSupport,
          variance: latestMC.variance,
          confidenceInterval: [latestMC.minSupport, latestMC.maxSupport],
        }
      : {
          totalRuns: 0,
          meanSupport: avgSupport,
          variance: 0,
          confidenceInterval: [avgSupport, avgSupport],
        },
    beliefEvolution: snapshots.map((s) => ({
      round: s.round,
      averagePolicySupport: s.averagePolicySupport,
      averageTrustInGovernment: s.averageTrustInGovernment,
      averageEconomicOutlook: s.averageEconomicOutlook,
    })),
  };

  res.json(GetSimulationReportResponse.parse(report));
});

export default router;
