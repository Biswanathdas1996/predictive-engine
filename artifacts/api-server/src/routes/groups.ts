import { Router, type IRouter } from "express";
import { db, groupsTable } from "@workspace/db";
import { ListGroupsResponse, CreateGroupBody } from "@workspace/api-zod";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/groups", async (_req, res): Promise<void> => {
  const groups = await db.select().from(groupsTable).orderBy(desc(groupsTable.createdAt));
  res.json(ListGroupsResponse.parse(groups));
});

router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [group] = await db
    .insert(groupsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(group);
});

export default router;
