import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { postsTable } from "./posts";
import { simulationsTable } from "./simulations";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  sentiment: real("sentiment").notNull().default(0),
  round: integer("round").notNull().default(0),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id),
  postId: integer("post_id").notNull().references(() => postsTable.id),
  simulationId: integer("simulation_id").notNull().references(() => simulationsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommentSchema = createInsertSchema(commentsTable).omit({ id: true, createdAt: true });
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
