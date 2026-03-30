import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { simulationsTable } from "./simulations";

export const postsTable = pgTable("posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  sentiment: real("sentiment").notNull().default(0),
  platform: text("platform").notNull().default("simulation"),
  topicTags: text("topic_tags").array().notNull().default([]),
  round: integer("round").notNull().default(0),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id),
  simulationId: integer("simulation_id").notNull().references(() => simulationsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true, createdAt: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
