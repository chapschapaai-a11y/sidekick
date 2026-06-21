import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tasks = await prisma.task.findMany({
    where: { userId },
    orderBy: [{ completed: "asc" }, { createdAt: "desc" }],
  });

  return Response.json({ tasks });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { title, priority, dueDate } = await req.json();
  if (!title?.trim()) {
    return Response.json({ error: "Title required" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      userId,
      title: title.trim(),
      priority: priority || "medium",
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  return Response.json({ task }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, completed, title, priority, dueDate } = await req.json();
  if (!id) {
    return Response.json({ error: "Task ID required" }, { status: 400 });
  }

  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(typeof completed === "boolean" && {
        completed,
        completedAt: completed ? new Date() : null,
      }),
      ...(title && { title: title.trim() }),
      ...(priority && { priority }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    },
  });

  return Response.json({ task });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return Response.json({ error: "Task ID required" }, { status: 400 });
  }

  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });

  return Response.json({ ok: true });
}
