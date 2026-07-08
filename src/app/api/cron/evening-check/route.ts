import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { sendSMS } from "@/lib/twilio";
import { fetchCalendarRange } from "@/lib/google";

export const maxDuration = 120;

// Daily ~5pm ET: look at each user's evening and offer one genuinely useful thing.
// The observant-assistant move: "you've got X at 7 — want me to handle dinner?"
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { smsConsent: true, phone: { not: null }, onboarded: true },
    select: { id: true, name: true, phone: true, sidekickName: true, diet: true, goals: true, location: true },
    take: 20,
  });

  const anthropic = new Anthropic();
  const results: { userId: string; status: string }[] = [];

  for (const user of users) {
    try {
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const endOfDay = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate() + 1);
      const events = await fetchCalendarRange(user.id, new Date(), endOfDay).catch(() => []);

      const eveningEvents = events.filter((e) => !e.allDay);
      if (eveningEvents.length === 0) {
        results.push({ userId: user.id, status: "nothing-this-evening" });
        continue;
      }

      const eventLines = eveningEvents
        .map((e) => `${e.title} at ${new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}${e.location ? ` (${e.location})` : ""}`)
        .join("; ");

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `You are ${user.sidekickName || "Sidekick"}, ${user.name || "the user"}'s personal assistant. It's late afternoon. Their remaining events today: ${eventLines}. Diet: ${user.diet.join(", ") || "none noted"}. Goals: ${user.goals.join("; ") || "none noted"}.

Write ONE short casual text (under 300 chars) that shows you noticed their evening and offer ONE concrete helpful thing (dinner handled around an event, a ride, prep). Sound like a sharp friend, lowercase-casual, no emojis at the start. If there is genuinely nothing useful to offer, reply exactly: SKIP`,
        }],
      });

      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      if (!text || text === "SKIP" || text.includes("SKIP")) {
        results.push({ userId: user.id, status: "skipped" });
        continue;
      }

      await sendSMS(user.phone!, text);
      results.push({ userId: user.id, status: "sent" });
    } catch (e) {
      results.push({ userId: user.id, status: `error: ${String(e).slice(0, 80)}` });
    }
  }

  return Response.json({ processed: users.length, results });
}
