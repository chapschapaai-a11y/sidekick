import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { morningBriefing: true, phone: true, wakeTime: true, timezone: true },
  });

  if (!user) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    enabled: user.morningBriefing,
    phone: user.phone,
    wakeTime: user.wakeTime || "07:00",
    timezone: user.timezone,
  });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.enabled === "boolean") data.morningBriefing = body.enabled;
  if (typeof body.phone === "string") data.phone = body.phone;
  if (typeof body.wakeTime === "string") data.wakeTime = body.wakeTime;

  await prisma.user.update({ where: { id: userId }, data });

  return Response.json({ success: true });
}
