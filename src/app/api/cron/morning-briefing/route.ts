import { NextRequest } from "next/server";
import { getUsersForBriefing, generateAndSendBriefing } from "@/lib/morning-briefing";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIds = await getUsersForBriefing();

  if (userIds.length === 0) {
    return Response.json({ message: "No users ready for briefing", count: 0 });
  }

  const results = await Promise.allSettled(
    userIds.map((id) => generateAndSendBriefing(id))
  );

  const summary = results.map((r, i) => ({
    userId: userIds[i],
    ...(r.status === "fulfilled" ? r.value : { sent: false, error: String(r.reason) }),
  }));

  return Response.json({ count: userIds.length, results: summary });
}
