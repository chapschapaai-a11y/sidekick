import { prisma } from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

export async function getGoogleToken(userId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!integration) return null;

  if (integration.expiresAt && integration.expiresAt < new Date()) {
    if (!integration.refreshToken) return null;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: integration.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const tokens = await res.json();
    if (!tokens.access_token) return null;

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      },
    });

    return tokens.access_token;
  }

  return integration.accessToken;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  allDay: boolean;
  calendarId?: string;
  calendarName?: string;
  readOnly?: boolean;
}

export async function fetchTodayEvents(userId: string): Promise<CalendarEvent[]> {
  return fetchCalendarRange(userId);
}

export async function fetchCalendarRange(
  userId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<CalendarEvent[]> {
  const token = await getGoogleToken(userId);
  if (!token) return [];

  // "Today" in the user's timezone, not server UTC (Vercel runs in UTC)
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const start = startDate || new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
  const end = endDate || new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  // Fetch all calendars the user has (primary + subscribed + shared)
  const calListRes = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  interface CalMeta { id: string; name: string; writable: boolean }
  let calendars: CalMeta[] = [{ id: "primary", name: "Primary", writable: true }];
  if (calListRes.ok) {
    const calListData = await calListRes.json();
    const items = calListData.items || [];
    const mapped = items
      .filter((c: Record<string, unknown>) => !c.deleted && c.selected !== false)
      .map((c: Record<string, unknown>): CalMeta => ({
        id: c.id as string,
        name: (c.summaryOverride as string) || (c.summary as string) || (c.id as string),
        writable: c.accessRole === "owner" || c.accessRole === "writer",
      }));
    if (mapped.length > 0) calendars = mapped;
    console.error("[CALENDAR] Fetching from", calendars.length, "calendars");
  } else {
    console.error("[CALENDAR:LIST] Failed:", calListRes.status, "— token may need reconnect; using primary only");
  }

  // Fetch events from all calendars in parallel
  const allFetches = calendars.map(async (cal) => {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((e: Record<string, unknown>) => ({
      id: e.id as string,
      title: (e.summary as string) || "Untitled",
      start: ((e.start as Record<string, string>)?.dateTime || (e.start as Record<string, string>)?.date) as string,
      end: ((e.end as Record<string, string>)?.dateTime || (e.end as Record<string, string>)?.date) as string,
      location: (e.location as string) || undefined,
      allDay: !!(e.start as Record<string, string>)?.date,
      calendarId: cal.id,
      calendarName: cal.name,
      readOnly: !cal.writable,
    })) as CalendarEvent[];
  });

  const results = await Promise.all(allFetches);
  // Dedupe — the same event can appear on multiple calendars (e.g. invites)
  const seen = new Set<string>();
  const googleEvents: CalendarEvent[] = [];
  for (const e of results.flat()) {
    const key = `${e.title}|${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    googleEvents.push(e);
  }

  // Also fetch ICS subscription events for this range
  const subs = await prisma.calendarSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return googleEvents;

  const { fetchICSEvents } = await import("@/lib/ics");
  const icsResults = await Promise.all(
    subs.map((s) => fetchICSEvents(s.url).catch(() => []))
  );

  const icsInRange: CalendarEvent[] = [];
  for (const events of icsResults) {
    for (const e of events) {
      const eventStart = new Date(e.start);
      if (eventStart >= start && eventStart < end) {
        icsInRange.push(e);
      }
    }
  }

  return [...googleEvents, ...icsInRange].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}

export async function createCalendarEvent(
  userId: string,
  title: string,
  startDateTime: string,
  endDateTime: string,
  location?: string,
  description?: string,
): Promise<{ id: string; htmlLink: string } | null> {
  const token = await getGoogleToken(userId);
  if (!token) return null;

  const event: Record<string, unknown> = {
    summary: title,
    start: { dateTime: startDateTime, timeZone: "America/New_York" },
    end: { dateTime: endDateTime, timeZone: "America/New_York" },
  };
  if (location) event.location = location;
  if (description) event.description = description;

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[CALENDAR:CREATE] Failed:", res.status, err);
    return null;
  }
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink };
}

export async function deleteCalendarEvent(
  userId: string,
  eventId: string,
  calendarId: string = "primary",
): Promise<{ success: boolean; error?: string }> {
  const token = await getGoogleToken(userId);
  if (!token) return { success: false, error: "Google Calendar not connected" };

  console.error("[CALENDAR:DELETE] Attempting to delete event:", eventId, "from calendar:", calendarId);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (res.status === 204 || res.status === 200) {
    console.error("[CALENDAR:DELETE] Success:", eventId);
    return { success: true };
  }

  if (res.status === 404) {
    console.error("[CALENDAR:DELETE] Event not found:", eventId);
    return { success: false, error: "Event not found — it may have already been deleted" };
  }

  if (res.status === 403) {
    const err = await res.text();
    console.error("[CALENDAR:DELETE] Permission denied:", err);
    return { success: false, error: "Permission denied — try disconnecting and reconnecting Google in the app to grant calendar write access" };
  }

  const err = await res.text();
  console.error("[CALENDAR:DELETE] Failed:", res.status, err);
  return { success: false, error: `Google Calendar returned error ${res.status}` };
}

export interface GmailThread {
  subject: string;
  from: string;
  snippet: string;
  date: string;
  unread: boolean;
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  body: string;
  date: string;
  unread: boolean;
}

export async function fetchUnreadEmails(userId: string): Promise<GmailMessageDetail[]> {
  const token = await getGoogleToken(userId);
  if (!token) return [];

  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=is:inbox+is:unread",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return [];

  const data = await res.json();
  const messages = data.messages || [];

  const results: GmailMessageDetail[] = [];
  for (const msg of messages.slice(0, 10)) {
    const detail = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!detail.ok) continue;
    const d = await detail.json();
    const headers = d.payload?.headers || [];
    const get = (name: string) => headers.find((h: Record<string, string>) => h.name === name)?.value || "";

    let body = d.snippet || "";
    const parts = d.payload?.parts || [];
    const textPart = parts.find((p: Record<string, string>) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
    } else if (d.payload?.body?.data) {
      body = Buffer.from(d.payload.body.data, "base64url").toString("utf-8");
    }

    results.push({
      id: msg.id,
      threadId: d.threadId,
      subject: get("Subject"),
      from: get("From"),
      to: get("To"),
      snippet: d.snippet || "",
      body: body.slice(0, 2000),
      date: get("Date"),
      unread: (d.labelIds || []).includes("UNREAD"),
    });
  }

  return results;
}

export async function createGmailDraft(
  userId: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
): Promise<string | null> {
  const token = await getGoogleToken(userId);
  if (!token) return null;

  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const rawEmail = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");

  const encoded = Buffer.from(rawEmail).toString("base64url");

  const draftBody: Record<string, unknown> = {
    message: { raw: encoded },
  };
  if (threadId) {
    (draftBody.message as Record<string, unknown>).threadId = threadId;
  }

  const res = await fetch("https://www.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draftBody),
  });

  if (!res.ok) return null;
  const draft = await res.json();
  return draft.id || null;
}

export async function deleteGmailDraft(
  userId: string,
  gmailDraftId: string,
): Promise<boolean> {
  const token = await getGoogleToken(userId);
  if (!token) return false;

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/drafts/${gmailDraftId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return res.ok || res.status === 404;
}

export async function checkGmailDraftExists(
  userId: string,
  gmailDraftId: string,
): Promise<boolean> {
  const token = await getGoogleToken(userId);
  if (!token) return false;

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/drafts/${gmailDraftId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return res.ok;
}

export async function fetchRecentEmails(userId: string): Promise<GmailThread[]> {
  const token = await getGoogleToken(userId);
  if (!token) return [];

  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=is:inbox",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return [];

  const data = await res.json();
  const messages = data.messages || [];

  const threads: GmailThread[] = [];
  for (const msg of messages.slice(0, 8)) {
    const detail = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!detail.ok) continue;
    const d = await detail.json();
    const headers = d.payload?.headers || [];
    const get = (name: string) => headers.find((h: Record<string, string>) => h.name === name)?.value || "";
    threads.push({
      subject: get("Subject"),
      from: get("From").replace(/<.*>/, "").trim(),
      snippet: d.snippet || "",
      date: get("Date"),
      unread: (d.labelIds || []).includes("UNREAD"),
    });
  }

  return threads;
}

export interface SentEmail {
  to: string;
  subject: string;
  body: string;
  date: string;
}

export async function fetchSentEmails(userId: string, maxResults = 20): Promise<SentEmail[]> {
  const token = await getGoogleToken(userId);
  if (!token) return [];

  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=in:sent`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return [];

  const data = await res.json();
  const messages = data.messages || [];
  const results: SentEmail[] = [];

  for (const msg of messages) {
    const detail = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!detail.ok) continue;
    const d = await detail.json();
    const headers = d.payload?.headers || [];
    const get = (name: string) => headers.find((h: Record<string, string>) => h.name === name)?.value || "";

    let body = d.snippet || "";
    const parts = d.payload?.parts || [];
    const textPart = parts.find((p: Record<string, string>) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
    } else if (d.payload?.body?.data) {
      body = Buffer.from(d.payload.body.data, "base64url").toString("utf-8");
    }

    results.push({
      to: get("To"),
      subject: get("Subject"),
      body: body.slice(0, 1500),
      date: get("Date"),
    });
  }

  return results;
}
