import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function GET() {
  const steps: string[] = [];
  try {
    steps.push("1. Importing browserbase module...");
    const { createBrowserSession } = await import("@/lib/browserbase");
    steps.push("2. Module imported OK");

    steps.push("3. Creating Browserbase session...");
    const { browser, page, sessionId } = await createBrowserSession();
    steps.push(`4. Session created: ${sessionId}`);

    steps.push("5. Navigating to OpenTable homepage first...");
    await page.goto("https://www.opentable.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const homeTitle = await page.title().catch(() => "unknown");
    steps.push(`5b. Homepage title: ${homeTitle}`);
    const homeText = (await page.locator("body").textContent({ timeout: 5000 }).catch(() => "") || "").slice(0, 300);
    steps.push(`5c. Homepage text: ${homeText}`);

    steps.push("6. Now navigating to restaurant page...");
    const url = "https://www.opentable.com/r/ledger-restaurant-and-bar-salem?covers=2&dateTime=2026-06-25T19:00";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    const title = await page.title().catch(() => "unknown");
    steps.push(`7. Page title: ${title}`);

    const bodyText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
    steps.push(`8. Body text length: ${bodyText?.length || 0}`);
    steps.push(`9. First 500 chars: ${(bodyText || "").slice(0, 500)}`);

    const interactiveCount = await page.locator("a, button, input, select, textarea").count();
    steps.push(`10. Interactive elements found: ${interactiveCount}`);

    await browser.close();
    steps.push("11. Browser closed. SUCCESS!");

    return NextResponse.json({ success: true, steps });
  } catch (e) {
    steps.push(`ERROR: ${String(e)}`);
    return NextResponse.json({ success: false, steps, error: String(e) }, { status: 500 });
  }
}
