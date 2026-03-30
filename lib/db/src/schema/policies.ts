import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const policiesTable = pgTable("policies", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPolicySchema = createInsertSchema(policiesTable).omit({ id: true, createdAt: true });
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type Policy = typeof policiesTable.$inferSelect;
