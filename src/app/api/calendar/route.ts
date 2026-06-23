import { getSessionUserId } from "@/lib/auth";
import { fetchTodayEvents, CalendarEvent } from "@/lib/google";
import { fetchICSEvents } from "@/lib/ics";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [googleEvents, subs] = await Promise.all([
    fetchTodayEvents(userId).catch(() => []),
    prisma.calendarSubscription.findMany({ where: { userId } }),
  ]);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const icsResults = await Promise.all(
    subs.map((s) => fetchICSEvents(s.url).catch(() => []))
  );

  const icsToday: CalendarEvent[] = [];
  for (const events of icsResults) {
    for (const e of events) {
      const eventStart = new Date(e.start);
      if (eventStart >= startOfDay && eventStart < endOfDay) {
        icsToday.push(e);
      }
    }
  }

  const allEvents = [...googleEvents, ...icsToday].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  return Response.json({ events: allEvents });
}
