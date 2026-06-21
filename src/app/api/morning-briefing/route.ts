import { getSessionUserId } from "@/lib/auth";
import { generateAndSendBriefing } from "@/lib/morning-briefing";
import { prisma } from "@/lib/db";
import { fetchTodayEvents } from "@/lib/google";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tasks: { where: { completed: false }, orderBy: { priority: "desc" }, take: 10 },
      wallet: { select: { balance: true } },
      integrations: { where: { browserContextId: { not: null } }, select: { provider: true } },
    },
  });

  if (!user) return Response.json({ error: "Not found" }, { status: 404 });

  const events = await fetchTodayEvents(userId);

  return Response.json({
    preview: true,
    data: {
      name: user.name,
      sidekickName: user.sidekickName,
      phone: user.phone,
      location: user.location,
      homeAddress: user.homeAddress,
      morningBriefing: user.morningBriefing,
      wakeTime: user.wakeTime,
      events: events.length,
      tasks: user.tasks.length,
      walletBalance: user.wallet?.balance ?? null,
      connectedApps: user.integrations.map((i) => i.provider),
    },
  });
}

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const result = await generateAndSendBriefing(userId);
  return Response.json(result);
}
