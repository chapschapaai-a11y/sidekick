import { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteGmailDraft, checkGmailDraftExists } from "@/lib/google";

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

  // Clean up drafts that were deleted directly in Gmail
  const validDrafts = [];
  for (const draft of drafts) {
    if (draft.gmailDraftId) {
      const exists = await checkGmailDraftExists(userId, draft.gmailDraftId);
      if (!exists) {
        await prisma.emailDraft.update({
          where: { id: draft.id },
          data: { status: "dismissed" },
        });
        continue;
      }
    }
    validDrafts.push(draft);
  }

  return Response.json({ drafts: validDrafts });
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

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return Response.json({ error: "ID required" }, { status: 400 });
  }

  const draft = await prisma.emailDraft.findFirst({
    where: { id, userId },
  });

  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  // Delete from Gmail too
  if (draft.gmailDraftId) {
    await deleteGmailDraft(userId, draft.gmailDraftId);
  }

  await prisma.emailDraft.delete({ where: { id } });

  return Response.json({ success: true });
}
