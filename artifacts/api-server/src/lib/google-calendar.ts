import { google } from "googleapis";
import { logger } from "./logger.js";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return oauth2Client;
}

export interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

export interface BookingResult {
  eventId: string;
  meetLink: string | null;
  start: string;
  end: string;
  message: string;
}

export async function getAvailableSlots(): Promise<TimeSlot[]> {
  try {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get busy times
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: sevenDaysLater.toISOString(),
        items: [{ id: CALENDAR_ID }],
      },
    });

    const busyPeriods =
      freeBusyResponse.data.calendars?.[CALENDAR_ID]?.busy || [];

    // Generate candidate slots: 30-min slots 9am–6pm IST (UTC+5:30)
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const slots: TimeSlot[] = [];

    for (let d = 1; d <= 7; d++) {
      const dayBase = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const dayDate = new Date(dayBase.toDateString()); // midnight UTC

      for (let hour = 9; hour < 18; hour++) {
        for (const min of [0, 30]) {
          // IST time → UTC
          const slotStartIST = new Date(
            dayDate.getTime() + (hour * 60 + min) * 60 * 1000 - IST_OFFSET
          );
          const slotEndIST = new Date(slotStartIST.getTime() + 60 * 60 * 1000);

          if (slotStartIST < now) continue;

          // Check overlap with busy periods
          const isBusy = busyPeriods.some((busy) => {
            const busyStart = new Date(busy.start!);
            const busyEnd = new Date(busy.end!);
            return slotStartIST < busyEnd && slotEndIST > busyStart;
          });

          if (!isBusy) {
            const label = slotStartIST.toLocaleString("en-IN", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            }) + " IST";

            slots.push({
              start: slotStartIST.toISOString(),
              end: slotEndIST.toISOString(),
              label,
            });
          }
        }
      }
    }

    // Return only first 6 slots to keep responses manageable
    return slots.slice(0, 6);
  } catch (err) {
    logger.error({ err }, "Failed to fetch Google Calendar availability");
    return [];
  }
}

export async function createCalendarEvent(
  start: string,
  end: string,
  attendeeEmail: string,
  attendeeName: string,
  summary?: string
): Promise<BookingResult> {
  const auth = getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    sendUpdates: "all",
    requestBody: {
      summary: summary || `Interview: ${attendeeName} ↔ Radhika Khattar`,
      description:
        `Scheduled via Radhika's AI Persona.\nAttendee: ${attendeeName} (${attendeeEmail})`,
      start: { dateTime: start, timeZone: "Asia/Kolkata" },
      end: { dateTime: end, timeZone: "Asia/Kolkata" },
      attendees: [
        { email: "radhikakhattar07@gmail.com", displayName: "Radhika Khattar" },
        { email: attendeeEmail, displayName: attendeeName },
      ],
      conferenceData: {
        createRequest: {
          requestId: `radhika-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
    conferenceDataVersion: 1,
  });

  const meetLink =
    event.data.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === "video"
    )?.uri ?? null;

  return {
    eventId: event.data.id!,
    meetLink,
    start: event.data.start?.dateTime || start,
    end: event.data.end?.dateTime || end,
    message: `Meeting confirmed! A Google Meet link has been created${meetLink ? `: ${meetLink}` : ""}. Calendar invites sent to ${attendeeEmail} and radhikakhattar07@gmail.com.`,
  };
}
