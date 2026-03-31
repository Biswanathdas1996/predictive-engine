import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { groupsTable } from "./groups";
import { simulationsTable } from "./simulations";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  gender: text("gender").notNull(),
  region: text("region").notNull(),
  occupation: text("occupation").notNull(),
  persona: text("persona").notNull(),
  systemPrompt: text("system_prompt"),
  stance: text("stance").notNull(),
  influenceScore: real("influence_score").notNull().default(0.5),
  credibilityScore: real("credibility_score").notNull().default(0.5),
  beliefState: jsonb("belief_state").notNull().default({
    policySupport: 0,
    trustInGovernment: 0.5,
    economicOutlook: 0.5,
  }),
  confidenceLevel: real("confidence_level").notNull().default(0.5),
  activityLevel: real("activity_level").notNull().default(0.5),
  groupId: integer("group_id").references(() => groupsTable.id, { onDelete: "set null" }),
  simulationId: integer("simulation_id").references(() => simulationsTable.id, { onDelete: "cascade" }),
  /** When true, this row is the human facilitator for user-injected thread replies (not a simulated agent). */
  isFacilitator: boolean("is_facilitator").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
