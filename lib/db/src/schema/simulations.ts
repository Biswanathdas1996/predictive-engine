import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const simulationsTable = pgTable("simulations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"),
  currentRound: integer("current_round").notNull().default(0),
  config: jsonb("config").notNull().default({
    learningRate: 0.3,
    numRounds: 10,
    agentCount: 10,
    policyId: null,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSimulationSchema = createInsertSchema(simulationsTable).omit({ id: true, createdAt: true });
export type InsertSimulation = z.infer<typeof insertSimulationSchema>;
export type Simulation = typeof simulationsTable.$inferSelect;
