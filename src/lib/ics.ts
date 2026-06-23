import type { CalendarEvent } from "@/lib/google";

export async function fetchICSEvents(url: string): Promise<CalendarEvent[]> {
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return [];

  const text = await res.text();
  return parseICS(text);
}

function parseICS(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const blocks = text.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const get = (key: string) => {
      const match = block.match(new RegExp(`^${key}[;:](.*)$`, "m"));
      return match ? match[1].replace(/\\n/g, "\n").replace(/\\,/g, ",").trim() : "";
    };

    const summary = get("SUMMARY");
    const location = get("LOCATION");
    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    const uid = get("UID") || `ics-${i}`;

    if (!summary || !dtstart) continue;

    const allDay = dtstart.length === 8; // YYYYMMDD = all-day
    const start = parseICSDate(dtstart);
    const end = dtend ? parseICSDate(dtend) : start;

    if (!start) continue;

    events.push({
      id: uid,
      title: summary,
      start: start.toISOString(),
      end: end?.toISOString() || start.toISOString(),
      location: location || undefined,
      allDay,
    });
  }

  return events;
}

function parseICSDate(value: string): Date | null {
  // Strip TZID prefix if present: TZID=America/New_York:20260622T090000
  const parts = value.split(":");
  const dateStr = parts.length > 1 ? parts[parts.length - 1] : parts[0];

  if (dateStr.length === 8) {
    // All-day: YYYYMMDD
    const y = parseInt(dateStr.slice(0, 4));
    const m = parseInt(dateStr.slice(4, 6)) - 1;
    const d = parseInt(dateStr.slice(6, 8));
    return new Date(y, m, d);
  }

  if (dateStr.length >= 15) {
    // DateTime: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
    const y = parseInt(dateStr.slice(0, 4));
    const m = parseInt(dateStr.slice(4, 6)) - 1;
    const d = parseInt(dateStr.slice(6, 8));
    const h = parseInt(dateStr.slice(9, 11));
    const min = parseInt(dateStr.slice(11, 13));
    const s = parseInt(dateStr.slice(13, 15));

    if (dateStr.endsWith("Z")) {
      return new Date(Date.UTC(y, m, d, h, min, s));
    }
    return new Date(y, m, d, h, min, s);
  }

  return null;
}
