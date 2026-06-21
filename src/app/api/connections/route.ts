import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const integrations = await prisma.integration.findMany({
    where: { userId, browserContextId: { not: null } },
    select: { provider: true, createdAt: true },
  });

  return Response.json({
    connections: integrations.map((i) => ({
      provider: i.provider,
      connectedAt: i.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { provider } = await req.json();
  if (!provider) return Response.json({ error: "Provider required" }, { status: 400 });

  await prisma.integration.deleteMany({
    where: { userId, provider },
  });

  return Response.json({ success: true });
}
