import { getSessionUserId } from "@/lib/auth";
import { generateDraftsForUser } from "@/lib/drafts";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const result = await generateDraftsForUser(userId);
  return Response.json(result);
}
