import { pgTable, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { simulationsTable } from "./simulations";

export const monteCarloRunsTable = pgTable("monte_carlo_runs", {
  id: serial("id").primaryKey(),
  simulationId: integer("simulation_id").notNull().references(() => simulationsTable.id),
  numRuns: integer("num_runs").notNull(),
  meanSupport: real("mean_support").notNull(),
  variance: real("variance").notNull(),
  minSupport: real("min_support").notNull(),
  maxSupport: real("max_support").notNull(),
  distribution: jsonb("distribution").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMonteCarloRunSchema = createInsertSchema(monteCarloRunsTable).omit({ id: true, createdAt: true });
export type InsertMonteCarloRun = z.infer<typeof insertMonteCarloRunSchema>;
export type MonteCarloRun = typeof monteCarloRunsTable.$inferSelect;
