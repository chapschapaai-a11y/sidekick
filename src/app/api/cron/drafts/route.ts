import { prisma } from "@/lib/db";
import { generateDraftsForUser } from "@/lib/drafts";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectedUsers = await prisma.integration.findMany({
    where: { provider: "google" },
    select: { userId: true },
  });

  const results = [];
  for (const { userId } of connectedUsers) {
    try {
      const result = await generateDraftsForUser(userId);
      results.push({ userId, generated: result.generated });
    } catch {
      results.push({ userId, generated: 0, error: true });
    }
  }

  return Response.json({
    scanned: connectedUsers.length,
    results,
  });
}
