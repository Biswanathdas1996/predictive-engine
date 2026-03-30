import { pgTable, text, serial, timestamp, integer, customType } from "drizzle-orm/pg-core";
import { policiesTable } from "./policies";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    return Buffer.from(value as string);
  },
});

export const policyAttachmentsTable = pgTable("policy_attachments", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id")
    .notNull()
    .references(() => policiesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type"),
  body: bytea("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PolicyAttachment = typeof policyAttachmentsTable.$inferSelect;
