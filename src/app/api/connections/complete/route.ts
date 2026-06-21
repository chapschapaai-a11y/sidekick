import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { provider } = await req.json();
  if (!provider) return Response.json({ error: "Provider required" }, { status: 400 });

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  if (!integration?.browserContextId) {
    return Response.json({ error: "No active connection session" }, { status: 400 });
  }

  await prisma.integration.update({
    where: { userId_provider: { userId, provider } },
    data: { updatedAt: new Date() },
  });

  return Response.json({ success: true, provider });
}
