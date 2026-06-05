import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const voiceCallsTable = pgTable("voice_calls", {
  id: serial("id").primaryKey(),
  callSid: text("call_sid").notNull().unique(),
  callerNumber: text("caller_number"),
  status: text("status").notNull().default("in-progress"),
  transcript: jsonb("transcript").$type<Array<{ role: string; content: string }>>().default([]),
  bookingEventId: text("booking_event_id"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const insertVoiceCallSchema = createInsertSchema(voiceCallsTable).omit({ id: true, startedAt: true });
export type InsertVoiceCall = z.infer<typeof insertVoiceCallSchema>;
export type VoiceCall = typeof voiceCallsTable.$inferSelect;
