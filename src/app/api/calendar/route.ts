import { getSessionUserId } from "@/lib/auth";
import { fetchTodayEvents } from "@/lib/google";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const events = await fetchTodayEvents(userId);
  return Response.json({ events });
}
