import { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const drafts = await prisma.emailDraft.findMany({
    where: { userId, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return Response.json({ drafts });
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, status } = await req.json();
  if (!id || !["approved", "dismissed"].includes(status)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const draft = await prisma.emailDraft.updateMany({
    where: { id, userId },
    data: { status },
  });

  return Response.json({ updated: draft.count });
}
