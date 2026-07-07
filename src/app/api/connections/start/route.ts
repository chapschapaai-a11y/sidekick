import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { chromium } from "playwright-core";

async function navigateSession(connectUrl: string, url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await chromium.connectOverCDP(connectUrl, { timeout: 15000 });
    try {
      const context = browser.contexts()[0];
      const page = context?.pages()[0];
      if (!page) return { success: false, error: "No page in session" };
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      } catch {
        // Some login pages hang domcontentloaded on redirects — commit is enough for the live view
        await page.goto(url, { waitUntil: "commit", timeout: 10000 });
      }
      return { success: true };
    } finally {
      // Disconnect the client only — keepAlive keeps the session (and page) running for the live view
      await browser.close().catch(() => {});
    }
  } catch (e) {
    return { success: false, error: String(e).slice(0, 200) };
  }
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
        // Phone-sized viewport so the live login view is readable on mobile
        viewport: { width: 430, height: 932 },
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
    const navResult = await navigateSession(session.connectUrl!, LOGIN_URLS[provider]);

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
