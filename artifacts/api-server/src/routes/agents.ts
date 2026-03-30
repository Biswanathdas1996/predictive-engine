import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable, influencesTable, postsTable } from "@workspace/db";
import {
  ListAgentsQueryParams,
  ListAgentsResponse,
  CreateAgentBody,
  GetAgentParams,
  GetAgentResponse,
  UpdateAgentParams,
  UpdateAgentBody,
  UpdateAgentResponse,
  DeleteAgentParams,
  GetAgentNeighborhoodParams,
  GetAgentNeighborhoodResponse,
  CreateInfluenceBody,
} from "@workspace/api-zod";
import { or } from "drizzle-orm";

const router: IRouter = Router();

router.get("/agents", async (req, res): Promise<void> => {
  const query = ListAgentsQueryParams.safeParse(req.query);
  let agents;
  if (query.success && query.data.simulationId) {
    agents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.simulationId, parseInt(query.data.simulationId, 10)));
  } else {
    agents = await db.select().from(agentsTable).orderBy(agentsTable.createdAt);
  }

  const mapped = agents.map((a) => ({
    ...a,
    beliefState: a.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
  }));

  res.json(ListAgentsResponse.parse(mapped));
});

router.post("/agents", async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: data.name,
      age: data.age,
      gender: data.gender,
      region: data.region,
      occupation: data.occupation,
      persona: data.persona,
      stance: data.stance,
      influenceScore: data.influenceScore ?? 0.5,
      credibilityScore: data.credibilityScore ?? 0.5,
      beliefState: data.beliefState ?? { policySupport: 0, trustInGovernment: 0.5, economicOutlook: 0.5 },
      confidenceLevel: data.confidenceLevel ?? 0.5,
      activityLevel: data.activityLevel ?? 0.5,
      groupId: data.groupId ?? null,
      simulationId: data.simulationId ?? null,
    })
    .returning();

  const mapped = {
    ...agent,
    beliefState: agent.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
  };
  res.status(201).json(GetAgentResponse.parse(mapped));
});

router.get("/agents/:id", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.id));

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const mapped = {
    ...agent,
    beliefState: agent.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
  };
  res.json(GetAgentResponse.parse(mapped));
});

router.patch("/agents/:id", async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.stance !== undefined) updateData.stance = parsed.data.stance;
  if (parsed.data.beliefState !== undefined) updateData.beliefState = parsed.data.beliefState;
  if (parsed.data.confidenceLevel !== undefined) updateData.confidenceLevel = parsed.data.confidenceLevel;
  if (parsed.data.activityLevel !== undefined) updateData.activityLevel = parsed.data.activityLevel;
  if (parsed.data.influenceScore !== undefined) updateData.influenceScore = parsed.data.influenceScore;
  if (parsed.data.credibilityScore !== undefined) updateData.credibilityScore = parsed.data.credibilityScore;

  const [agent] = await db
    .update(agentsTable)
    .set(updateData)
    .where(eq(agentsTable.id, params.data.id))
    .returning();

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const mapped = {
    ...agent,
    beliefState: agent.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
  };
  res.json(UpdateAgentResponse.parse(mapped));
});

router.delete("/agents/:id", async (req, res): Promise<void> => {
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [agent] = await db
    .delete(agentsTable)
    .where(eq(agentsTable.id, params.data.id))
    .returning();

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/agents/:id/neighborhood", async (req, res): Promise<void> => {
  const params = GetAgentNeighborhoodParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.id));

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const outgoing = await db
    .select()
    .from(influencesTable)
    .where(eq(influencesTable.sourceAgentId, params.data.id));

  const incoming = await db
    .select()
    .from(influencesTable)
    .where(eq(influencesTable.targetAgentId, params.data.id));

  const neighborIds = new Set<number>();
  const connections: Array<{ agent: typeof agent; influenceWeight: number; direction: string }> = [];

  for (const inf of outgoing) {
    neighborIds.add(inf.targetAgentId);
  }
  for (const inf of incoming) {
    neighborIds.add(inf.sourceAgentId);
  }

  for (const nId of neighborIds) {
    const [neighbor] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, nId));

    if (neighbor) {
      const outInf = outgoing.find((i) => i.targetAgentId === nId);
      const inInf = incoming.find((i) => i.sourceAgentId === nId);
      connections.push({
        agent: {
          ...neighbor,
          beliefState: neighbor.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
        },
        influenceWeight: outInf?.weight || inInf?.weight || 0,
        direction: outInf ? "outgoing" : "incoming",
      });
    }
  }

  const posts = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.agentId, params.data.id))
    .limit(20);

  const agentMapped = {
    ...agent,
    beliefState: agent.beliefState as { policySupport: number; trustInGovernment: number; economicOutlook: number },
  };

  const postsWithNames = posts.map((p) => ({ ...p, agentName: agent.name }));

  res.json(
    GetAgentNeighborhoodResponse.parse({
      agent: agentMapped,
      connections,
      posts: postsWithNames,
    })
  );
});

router.post("/influences", async (req, res): Promise<void> => {
  const parsed = CreateInfluenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [influence] = await db
    .insert(influencesTable)
    .values({
      sourceAgentId: parsed.data.sourceAgentId,
      targetAgentId: parsed.data.targetAgentId,
      weight: parsed.data.weight,
    })
    .returning();

  res.status(201).json(influence);
});

export default router;
