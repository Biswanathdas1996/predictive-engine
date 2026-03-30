import { pgTable, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { simulationsTable } from "./simulations";

export const beliefSnapshotsTable = pgTable("belief_snapshots", {
  id: serial("id").primaryKey(),
  simulationId: integer("simulation_id").notNull().references(() => simulationsTable.id),
  round: integer("round").notNull(),
  averagePolicySupport: real("average_policy_support").notNull(),
  averageTrustInGovernment: real("average_trust_in_government").notNull(),
  averageEconomicOutlook: real("average_economic_outlook").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBeliefSnapshotSchema = createInsertSchema(beliefSnapshotsTable).omit({ id: true, createdAt: true });
export type InsertBeliefSnapshot = z.infer<typeof insertBeliefSnapshotSchema>;
export type BeliefSnapshot = typeof beliefSnapshotsTable.$inferSelect;
