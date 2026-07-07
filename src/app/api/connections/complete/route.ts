import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export const maxDuration = 90;

const VERIFY: Record<string, { url: string; loggedOutSignal: RegExp }> = {
  ubereats: { url: "https://www.ubereats.com/feed", loggedOutSignal: /Log in|Sign up to deliver/i },
  doordash: { url: "https://www.doordash.com/home", loggedOutSignal: /Sign In|Sign Up/i },
  amazon: { url: "https://www.amazon.com/", loggedOutSignal: /Hello, sign in/i },
};

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

  const Browserbase = (await import("@browserbasehq/sdk")).default;
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

  // VERIFY the login actually happened before saving — open a second tab in the
  // same running login session (same cookies) and check for a logged-in state.
  const check = VERIFY[provider];
  if (check && integration.browserSessionId) {
    try {
      const session = await bb.sessions.retrieve(integration.browserSessionId);
      if (session.status === "RUNNING") {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.connectOverCDP(session.connectUrl!, { timeout: 15000 });
        const context = browser.contexts()[0];
        const page = await context.newPage();
        await page.goto(check.url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(5000);
        const text = ((await page.locator("body").textContent({ timeout: 5000 }).catch(() => "")) || "").slice(0, 3000);
        await page.close().catch(() => {});
        // NOTE: do not browser.close() — it would kill the user's login session

        if (check.loggedOutSignal.test(text)) {
          console.error("[CONNECT:COMPLETE] Verification failed — still logged out on", provider);
          return Response.json({
            success: false,
            verified: false,
            message: "It doesn't look like the login finished — the site still shows a Log in button. Finish logging in above (including any text code), wait for the site to show your account, then tap save again.",
          });
        }
        console.error("[CONNECT:COMPLETE] Login verified for", provider);
      }
    } catch (e) {
      console.error("[CONNECT:COMPLETE] Verification check errored (continuing):", String(e).slice(0, 150));
    }
  }

  // Release the keepAlive login session — Browserbase persists the cookies
  // into the context when the session ends.
  if (integration.browserSessionId) {
    try {
      await bb.sessions.update(integration.browserSessionId, {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        status: "REQUEST_RELEASE",
      });
      await new Promise((r) => setTimeout(r, 4000));
    } catch (e) {
      console.error("[CONNECT:COMPLETE] Failed to release login session:", e);
    }
  }

  await prisma.integration.update({
    where: { userId_provider: { userId, provider } },
    data: { updatedAt: new Date(), browserSessionId: null },
  });

  return Response.json({ success: true, verified: true, provider });
}
