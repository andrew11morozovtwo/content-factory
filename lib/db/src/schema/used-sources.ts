import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const usedSourcesTable = pgTable("used_sources", {
  id: serial("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  usedAt: timestamp("used_at").notNull().defaultNow(),
});
