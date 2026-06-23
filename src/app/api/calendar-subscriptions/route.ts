import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { fetchICSEvents } from "@/lib/ics";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const subs = await prisma.calendarSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ subscriptions: subs });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { name, url, provider } = await req.json();
  if (!url || !name) {
    return Response.json({ error: "Name and URL are required" }, { status: 400 });
  }

  // Validate the URL actually returns ICS data
  try {
    const events = await fetchICSEvents(url);
    if (events.length === 0) {
      // Try fetching raw to check if it's valid ICS at all
      const res = await fetch(url);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        return Response.json(
          { error: "This URL doesn't look like a calendar feed. Make sure you copied the subscription/ICS URL." },
          { status: 400 },
        );
      }
    }
  } catch {
    return Response.json(
      { error: "Couldn't reach that URL. Double-check it and try again." },
      { status: 400 },
    );
  }

  const sub = await prisma.calendarSubscription.upsert({
    where: { userId_url: { userId, url } },
    create: { userId, name, url, provider: provider || "other" },
    update: { name, provider: provider || "other" },
  });

  return Response.json({ subscription: sub });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return Response.json({ error: "ID required" }, { status: 400 });

  await prisma.calendarSubscription.deleteMany({
    where: { id, userId },
  });

  return Response.json({ success: true });
}
