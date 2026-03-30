import { Router, type IRouter } from "express";
import { db, eventsTable } from "@workspace/db";
import { ListEventsQueryParams, ListEventsResponse, CreateEventBody } from "@workspace/api-zod";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/events", async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  let events;

  if (query.success && query.data.simulationId) {
    events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.simulationId, query.data.simulationId))
      .orderBy(desc(eventsTable.createdAt));
  } else {
    events = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt));
  }

  res.json(ListEventsResponse.parse(events));
});

router.post("/events", async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [event] = await db
    .insert(eventsTable)
    .values({
      type: parsed.data.type,
      description: parsed.data.description,
      impactScore: parsed.data.impactScore,
      simulationId: parsed.data.simulationId ?? null,
    })
    .returning();

  res.status(201).json(event);
});

export default router;
