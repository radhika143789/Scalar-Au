import { Router } from "express";
import { getAvailableSlots, createCalendarEvent } from "../lib/google-calendar.js";

const router = Router();

// GET /api/calendar/availability
router.get("/calendar/availability", async (req, res) => {
  try {
    const slots = await getAvailableSlots();
    res.json({ slots });
  } catch (err) {
    req.log.error({ err }, "Failed to get availability");
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

// POST /api/calendar/book
router.post("/calendar/book", async (req, res) => {
  const { start, end, attendeeEmail, attendeeName, summary } = req.body as {
    start: string;
    end: string;
    attendeeEmail: string;
    attendeeName: string;
    summary?: string;
  };

  if (!start || !end || !attendeeEmail || !attendeeName) {
    res.status(400).json({ error: "start, end, attendeeEmail, attendeeName required" });
    return;
  }

  try {
    const result = await createCalendarEvent(start, end, attendeeEmail, attendeeName, summary);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to book meeting");
    res.status(500).json({ error: "Failed to book meeting" });
  }
});

export default router;
