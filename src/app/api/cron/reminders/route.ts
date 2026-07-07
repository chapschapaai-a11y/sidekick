import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sendSMS } from "@/lib/twilio";

export const maxDuration = 60;

// Runs every 5 minutes: text any reminder that has come due, respecting SMS consent.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await prisma.reminder.findMany({
    where: { sent: false, remindAt: { lte: new Date() } },
    include: { user: { select: { phone: true, smsConsent: true, name: true, sidekickName: true } } },
    take: 50,
  });

  if (due.length === 0) {
    return Response.json({ sent: 0 });
  }

  let sent = 0;
  const results: { id: string; status: string }[] = [];

  for (const r of due) {
    let status = "skipped";
    if (r.user.phone && r.user.smsConsent) {
      try {
        const from = r.user.sidekickName || "Sidekick";
        await sendSMS(r.user.phone, `⏰ ${from} reminder: ${r.text}`);
        status = "sent";
        sent++;
      } catch (e) {
        status = `sms-failed: ${String(e).slice(0, 80)}`;
      }
    } else {
      status = r.user.phone ? "no-sms-consent" : "no-phone";
    }

    // Mark handled either way so a bad number doesn't retry forever;
    // in-app UI still shows it. Recurring reminders schedule the next one.
    await prisma.reminder.update({
      where: { id: r.id },
      data: { sent: true, sentAt: new Date() },
    });

    if (r.recurring) {
      const next = new Date(r.remindAt);
      if (r.recurring === "daily") next.setDate(next.getDate() + 1);
      else if (r.recurring === "weekly") next.setDate(next.getDate() + 7);
      else if (r.recurring === "weekdays") {
        do { next.setDate(next.getDate() + 1); } while ([0, 6].includes(next.getUTCDay()));
      }
      await prisma.reminder.create({
        data: { userId: r.userId, text: r.text, remindAt: next, recurring: r.recurring },
      });
    }

    results.push({ id: r.id, status });
  }

  return Response.json({ sent, processed: due.length, results });
}
