import { Router, type IRouter } from "express";
import { db, policiesTable } from "@workspace/db";
import { ListPoliciesResponse, CreatePolicyBody } from "@workspace/api-zod";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/policies", async (_req, res): Promise<void> => {
  const policies = await db.select().from(policiesTable).orderBy(desc(policiesTable.createdAt));
  res.json(ListPoliciesResponse.parse(policies));
});

router.post("/policies", async (req, res): Promise<void> => {
  const parsed = CreatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [policy] = await db
    .insert(policiesTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(policy);
});

export default router;
