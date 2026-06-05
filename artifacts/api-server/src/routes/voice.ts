import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCallsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "../lib/openai-client.js";
import { VOICE_SYSTEM_PROMPT } from "../lib/persona.js";
import { getAvailableSlots, createCalendarEvent } from "../lib/google-calendar.js";

const router = Router();

function twimlSay(text: string, gather = true, gatherRoute = "/api/voice/gather"): string {
  const gatherXml = gather
    ? `<Gather input="speech" action="${gatherRoute}" method="POST" speechTimeout="auto" language="en-IN" enhanced="true">
        <Say voice="Polly.Aditi">${escapeXml(text)}</Say>
      </Gather>
      <Say voice="Polly.Aditi">I didn't catch that. Goodbye!</Say>`
    : `<Say voice="Polly.Aditi">${escapeXml(text)}</Say>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherXml}
</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// POST /api/voice/inbound — Twilio calls this when someone calls the number
router.post("/voice/inbound", async (req, res) => {
  const { CallSid, From } = req.body as { CallSid: string; From: string };

  // Create or find call record
  await db
    .insert(voiceCallsTable)
    .values({ callSid: CallSid, callerNumber: From, status: "in-progress", transcript: [] })
    .onConflictDoNothing();

  const greeting =
    "Hello! I'm Radhika Khattar's AI representative. I'm here to tell you about Radhika's background, skills, and experience — and I can also check her calendar and book an interview. What would you like to know?";

  res.setHeader("Content-Type", "text/xml");
  res.send(twimlSay(greeting));
});

// POST /api/voice/gather — Twilio sends speech results here
router.post("/voice/gather", async (req, res) => {
  const { SpeechResult, CallSid, From } = req.body as {
    SpeechResult?: string;
    CallSid: string;
    From?: string;
  };

  res.setHeader("Content-Type", "text/xml");

  if (!SpeechResult || SpeechResult.trim() === "") {
    res.send(twimlSay("Sorry, I didn't catch that. Could you repeat?"));
    return;
  }

  try {
    // Load call transcript
    const [call] = await db
      .select()
      .from(voiceCallsTable)
      .where(eq(voiceCallsTable.callSid, CallSid))
      .limit(1);

    const transcript: Array<{ role: string; content: string }> =
      (call?.transcript as Array<{ role: string; content: string }>) || [];

    // Detect booking intent
    const wantsBooking = /book|schedul|availab|meeting|slot|appointment|when/i.test(SpeechResult);

    let slotContext = "";
    let slots: Array<{ start: string; end: string; label: string }> = [];

    if (wantsBooking) {
      slots = await getAvailableSlots();
      if (slots.length > 0) {
        slotContext =
          "\n\nAvailable slots:\n" +
          slots.slice(0, 3).map((s, i) => `${i + 1}. ${s.label}`).join("\n") +
          "\n\nOffer these slots to the caller. If they choose one, ask for their name and email address to confirm the booking.";
      }
    }

    // Detect if caller is providing booking info
    const emailMatch = SpeechResult.match(
      /[\w.+-]+\s*(?:at|@)\s*[\w.+-]+\s*(?:dot|\.)\s*\w+/i
    );
    const hasEmail = !!emailMatch;

    // Try to detect if they're confirming a specific slot number
    const slotNumMatch = SpeechResult.match(/\b([123]|first|second|third|one|two|three)\b/i);
    const slotNumber = slotNumMatch
      ? ["first", "one", "1"].some((w) => slotNumMatch[1].toLowerCase() === w)
        ? 0
        : ["second", "two", "2"].some((w) => slotNumMatch[1].toLowerCase() === w)
        ? 1
        : 2
      : null;

    // Auto-book if we have enough info
    let bookingNote = "";
    if (hasEmail && slotNumber !== null && transcript.some((t) => /slot|available/i.test(t.content))) {
      const slot = slots[slotNumber] || slots[0];
      if (slot) {
        const emailRaw = emailMatch![0]
          .replace(/\s*at\s*/i, "@")
          .replace(/\s*dot\s*/i, ".")
          .replace(/\s/g, "");
        const callerName = From || "Caller";

        try {
          const booking = await createCalendarEvent(
            slot.start,
            slot.end,
            emailRaw,
            callerName
          );
          bookingNote = `\n\nBOOKING CONFIRMED: A meeting has been booked for ${slot.label}. Event ID: ${booking.eventId}. Tell the caller the booking is confirmed and invites have been sent.`;

          // Update call record
          await db
            .update(voiceCallsTable)
            .set({ bookingEventId: booking.eventId })
            .where(eq(voiceCallsTable.callSid, CallSid));
        } catch {
          bookingNote = "\n\nBooking failed — apologize and tell them to email radhikakhattar07@gmail.com directly.";
        }
      }
    }

    // Update transcript
    transcript.push({ role: "user", content: SpeechResult });

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: VOICE_SYSTEM_PROMPT + slotContext + bookingNote },
      ...transcript.slice(-6).map((t) => ({
        role: t.role as "user" | "assistant",
        content: t.content,
      })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 150,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "I'm sorry, could you repeat that?";

    // Save to transcript
    transcript.push({ role: "assistant", content: reply });

    await db
      .update(voiceCallsTable)
      .set({ transcript })
      .where(eq(voiceCallsTable.callSid, CallSid));

    // Check if call should end
    const shouldEnd = /goodbye|bye|thank you|that.s all|hang up/i.test(SpeechResult);

    if (shouldEnd) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">${escapeXml(reply)}</Say>
  <Hangup/>
</Response>`);
    } else {
      res.send(twimlSay(reply));
    }
  } catch (err) {
    req.log.error({ err }, "Voice gather error");
    res.send(
      twimlSay(
        "I'm having a small technical issue. Please try again in a moment, or email radhikakhattar07@gmail.com directly.",
        false
      )
    );
  }
});

// POST /api/voice/status
router.post("/voice/status", async (req, res) => {
  const { CallSid, CallStatus } = req.body as {
    CallSid: string;
    CallStatus: string;
  };

  if (["completed", "failed", "busy", "no-answer"].includes(CallStatus)) {
    await db
      .update(voiceCallsTable)
      .set({ status: CallStatus, endedAt: new Date() })
      .where(eq(voiceCallsTable.callSid, CallSid));
  }

  res.sendStatus(200);
});

export default router;
