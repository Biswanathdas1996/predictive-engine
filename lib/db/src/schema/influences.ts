import { pgTable, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

export const influencesTable = pgTable("influences", {
  id: serial("id").primaryKey(),
  sourceAgentId: integer("source_agent_id").notNull().references(() => agentsTable.id),
  targetAgentId: integer("target_agent_id").notNull().references(() => agentsTable.id),
  weight: real("weight").notNull().default(0.5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInfluenceSchema = createInsertSchema(influencesTable).omit({ id: true, createdAt: true });
export type InsertInfluence = z.infer<typeof insertInfluenceSchema>;
export type Influence = typeof influencesTable.$inferSelect;
