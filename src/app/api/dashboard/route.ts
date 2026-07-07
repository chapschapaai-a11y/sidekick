import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tasks: {
        orderBy: [{ completed: "asc" }, { createdAt: "desc" }],
        take: 20,
      },
      wallet: { select: { balance: true } },
      integrations: { select: { provider: true, accountEmail: true } },
      reminders: {
        where: { sent: false, remindAt: { gte: new Date() } },
        orderBy: { remindAt: "asc" },
        take: 5,
      },
      lists: {
        orderBy: { updatedAt: "desc" },
        take: 4,
      },
      followUps: {
        where: { resolved: false },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "good morning," : hour < 17 ? "good afternoon," : "good evening,";

  return Response.json({
    greeting,
    name: user.name || "there",
    sidekickName: user.sidekickName,
    initial: (user.name || "U")[0].toUpperCase(),
    location: user.location || null,
    latitude: user.latitude,
    longitude: user.longitude,
    tasks: user.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      completed: t.completed,
      priority: t.priority,
      dueDate: t.dueDate,
    })),
    walletBalance: user.wallet?.balance ?? null,
    reminders: user.reminders.map((r) => ({ id: r.id, text: r.text, remindAt: r.remindAt, recurring: r.recurring })),
    lists: user.lists.map((l) => ({ id: l.id, name: l.name, items: l.items })),
    followUps: user.followUps.map((f) => ({ id: f.id, person: f.person, about: f.about, direction: f.direction })),
    calendarConnected: user.integrations.some((i) => i.provider === "google"),
    emailConnected: user.integrations.some((i) => i.provider === "google"),
    googleEmail: user.integrations.find((i) => i.provider === "google")?.accountEmail || null,
  });
}
