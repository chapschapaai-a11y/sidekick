import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import Browserbase from "@browserbasehq/sdk";

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});

const LOGIN_URLS: Record<string, string> = {
  ubereats: "https://auth.uber.com/v2/",
  doordash: "https://identity.doordash.com/auth/user/login",
  lyft: "https://www.lyft.com/login",
  amazon: "https://www.amazon.com/ap/signin",
};

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { provider } = await req.json();
  if (!provider || !LOGIN_URLS[provider]) {
    return Response.json({ error: "Invalid provider" }, { status: 400 });
  }

  const existing = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  let contextId = existing?.browserContextId;

  if (!contextId) {
    const context = await bb.contexts.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    });
    contextId = context.id;
  }

  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      context: { id: contextId, persist: true },
    },
  });

  await prisma.integration.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      provider,
      accessToken: "browser-session",
      browserContextId: contextId,
      browserSessionId: session.id,
    },
    update: {
      browserContextId: contextId,
      browserSessionId: session.id,
    },
  });

  const liveUrls = await bb.sessions.debug(session.id);

  return Response.json({
    sessionId: session.id,
    contextId,
    liveUrl: liveUrls.debuggerFullscreenUrl,
    loginUrl: LOGIN_URLS[provider],
  });
}
