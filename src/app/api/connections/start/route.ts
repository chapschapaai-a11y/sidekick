import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import WS from "ws";

function navigateCDP(connectUrl: string, url: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: "CDP connection timed out after 15s" });
    }, 15000);

    let ws: WS;
    try {
      ws = new WS(connectUrl);
    } catch (e) {
      clearTimeout(timeout);
      resolve({ success: false, error: `WebSocket creation failed: ${e}` });
      return;
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Page.navigate",
        params: { url },
      }));
    });

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data.id === 1) {
          clearTimeout(timeout);
          if (data.error) {
            resolve({ success: false, error: `CDP navigate error: ${JSON.stringify(data.error)}` });
          } else {
            resolve({ success: true });
          }
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `WebSocket error: ${err.message}` });
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `WebSocket closed: ${code} ${reason}` });
    });
  });
}

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

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return Response.json(
      { error: "Browserbase not configured", detail: "BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID missing from env" },
      { status: 503 },
    );
  }

  let step = "importing SDK";
  try {
    const Browserbase = (await import("@browserbasehq/sdk")).default;
    step = "creating client";
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

    step = "checking existing integration";
    const existing = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    });

    let contextId = existing?.browserContextId;

    if (!contextId) {
      step = "creating browser context";
      const context = await bb.contexts.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
      });
      contextId = context.id;
    }

    step = "creating browser session";
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      keepAlive: true,
      browserSettings: {
        context: { id: contextId, persist: true },
      },
    });

    step = "getting debug URL";
    const liveUrls = await bb.sessions.debug(session.id);

    step = "saving integration";
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

    step = "navigating to login page";
    const navResult = await navigateCDP(session.connectUrl!, LOGIN_URLS[provider]);

    return Response.json({
      sessionId: session.id,
      contextId,
      liveUrl: liveUrls.debuggerFullscreenUrl,
      loginUrl: LOGIN_URLS[provider],
      navigationSuccess: navResult.success,
      navigationError: navResult.error || null,
    });
  } catch (e) {
    return Response.json(
      { error: `Failed at: ${step}`, detail: String(e) },
      { status: 503 },
    );
  }
}
