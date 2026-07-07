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

  // CRITICAL: release the keepAlive login session. Browserbase persists the
  // login cookies into the context when the session ends — without this, the
  // login is lost and every order hits a sign-in wall.
  if (integration.browserSessionId) {
    try {
      const Browserbase = (await import("@browserbasehq/sdk")).default;
      const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
      await bb.sessions.update(integration.browserSessionId, {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        status: "REQUEST_RELEASE",
      });
      // Give Browserbase a moment to flush cookies into the context
      await new Promise((r) => setTimeout(r, 4000));
    } catch (e) {
      console.error("[CONNECT:COMPLETE] Failed to release login session:", e);
    }
  }

  await prisma.integration.update({
    where: { userId_provider: { userId, provider } },
    data: { updatedAt: new Date(), browserSessionId: null },
  });

  return Response.json({ success: true, provider });
}
