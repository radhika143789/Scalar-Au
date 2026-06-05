import { Router } from "express";
import { db } from "@workspace/db";
import { chatMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { openai } from "../lib/openai-client.js";
import { PERSONA_SYSTEM_PROMPT } from "../lib/persona.js";
import { getAvailableSlots } from "../lib/google-calendar.js";

const router = Router();

// POST /api/chat/message — streaming SSE chat
router.post("/chat/message", async (req, res) => {
  const { message, sessionId } = req.body as {
    message: string;
    sessionId: string;
  };

  if (!message || !sessionId) {
    res.status(400).json({ error: "message and sessionId required" });
    return;
  }

  try {
    // Save user message
    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "user",
      content: message,
    });

    // Load history (last 20 messages)
    const history = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, sessionId))
      .orderBy(asc(chatMessagesTable.createdAt))
      .limit(20);

    // Check if user is asking about availability/booking
    const wantsAvailability =
      /availab|book|schedul|meeting|call|slot|time|when/i.test(message);

    let slots = null;
    let slotContext = "";
    if (wantsAvailability) {
      slots = await getAvailableSlots();
      if (slots.length > 0) {
        slotContext =
          "\n\nCurrent available slots for booking:\n" +
          slots.map((s, i) => `${i + 1}. ${s.label}`).join("\n") +
          "\n\nIf the user wants to book, ask for their name and email to confirm.";
      }
    }

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: PERSONA_SYSTEM_PROMPT + slotContext },
      ...history.slice(0, -1).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    // Stream response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      stream: true,
      max_tokens: 512,
      temperature: 0.7,
    });

    let fullReply = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullReply += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // Save assistant reply
    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "assistant",
      content: fullReply,
    });

    // Send slots if applicable
    if (slots && slots.length > 0) {
      res.write(`data: ${JSON.stringify({ slots })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Chat message error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate response" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

// GET /api/chat/history
router.get("/chat/history", async (req, res) => {
  const { sessionId } = req.query as { sessionId: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(asc(chatMessagesTable.createdAt))
    .limit(50);

  res.json(messages);
});

export default router;
