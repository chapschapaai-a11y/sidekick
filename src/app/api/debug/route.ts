import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const maxDuration = 120;

// Ops diagnostics — requires the CRON_SECRET, never exposed to browsers/users.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-debug-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const provider = req.nextUrl.searchParams.get("provider") || "ubereats";
  const live = req.nextUrl.searchParams.get("live") === "1";

  const integrations = await prisma.integration.findMany({
    where: { provider: { in: ["ubereats", "doordash", "amazon", "lyft"] } },
    select: {
      provider: true,
      browserContextId: true,
      browserSessionId: true,
      updatedAt: true,
      user: { select: { email: true } },
    },
  });

  const summary = integrations.map((i) => ({
    provider: i.provider,
    contextId: i.browserContextId ? i.browserContextId.slice(0, 10) + "…" : null,
    pendingLoginSession: i.browserSessionId ? i.browserSessionId.slice(0, 10) + "…" : null,
    updatedAt: i.updatedAt,
    user: i.user.email,
  }));

  if (!live) {
    return Response.json({ integrations: summary });
  }

  const target = integrations.find((i) => i.provider === provider && i.browserContextId);
  if (!target) {
    return Response.json({ integrations: summary, liveCheck: `no ${provider} context found` });
  }

  const trySso = req.nextUrl.searchParams.get("sso") === "1";

  try {
    const { createBrowserSession } = await import("@/lib/browserbase");
    const { browser, page } = await createBrowserSession(target.browserContextId!);
    const url = provider === "doordash" ? "https://www.doordash.com/home" : "https://www.ubereats.com/feed";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(6000);

    let ssoResult: string | null = null;
    if (trySso && provider === "ubereats") {
      // If central Uber cookies survived, clicking Log in signs in without credentials
      const loginBtn = page.locator('a:has-text("Log in"), button:has-text("Log in")').first();
      if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await loginBtn.click().catch(() => {});
        await page.waitForTimeout(8000);
        ssoResult = `after click: ${page.url()}`;
        // If we ended up back on ubereats without a credential form, SSO worked
      } else {
        ssoResult = "no Log in button visible";
      }
    }

    const finalUrl = page.url();
    const text = ((await page.locator("body").textContent({ timeout: 5000 }).catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    await browser.close().catch(() => {});

    return Response.json({
      integrations: summary,
      liveCheck: {
        provider,
        landedOn: finalUrl,
        hasLoginPrompt: /log in|sign in/i.test(text.slice(0, 2500)),
        asksForCredentials: /phone number or email|enter your password|verification code/i.test(text.slice(0, 3000)),
        ssoResult,
        textSample: text.slice(0, 500),
      },
    });
  } catch (e) {
    return Response.json({ integrations: summary, liveCheck: `browser check failed: ${String(e).slice(0, 200)}` });
  }
}
