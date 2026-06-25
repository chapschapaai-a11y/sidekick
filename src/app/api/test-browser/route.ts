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

    steps.push("5. Navigating to OpenTable homepage...");
    await page.goto("https://www.opentable.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const homeTitle = await page.title().catch(() => "unknown");
    steps.push(`5b. Homepage title: ${homeTitle}`);

    steps.push("6. Dismissing cookie banner...");
    const cookieAccept = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept"), button:has-text("Accept All"), button:has-text("I Accept")').first();
    const cookieVisible = await cookieAccept.isVisible({ timeout: 3000 }).catch(() => false);
    steps.push(`6b. Cookie banner visible: ${cookieVisible}`);
    if (cookieVisible) {
      await cookieAccept.click();
      await page.waitForTimeout(2000);
      steps.push("6c. Cookie banner dismissed");
    }

    steps.push("7. Searching for restaurant...");
    const searchInput = page.locator('#home-autocomplete-input, input[placeholder*="Location, Restaurant"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    steps.push(`7b. Search input visible: ${searchVisible}`);

    if (searchVisible) {
      await searchInput.click();
      await searchInput.fill("Ledger Salem MA");
      await page.waitForTimeout(2000);

      const suggestions = await page.locator('[role="option"], [role="listbox"] li, [class*="suggestion"], [class*="autocomplete"] a, [class*="Suggestion"]').count();
      steps.push(`8. Autocomplete suggestions: ${suggestions}`);

      if (suggestions > 0) {
        const firstSuggestion = page.locator('[role="option"], [role="listbox"] li, [class*="suggestion"], [class*="autocomplete"] a, [class*="Suggestion"]').first();
        const suggestionText = await firstSuggestion.textContent({ timeout: 2000 }).catch(() => "");
        steps.push(`8b. First suggestion: ${(suggestionText || "").slice(0, 100)}`);
        await firstSuggestion.click();
        await page.waitForTimeout(4000);
      } else {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4000);
      }

      const title = await page.title().catch(() => "unknown");
      steps.push(`9. Page title after search: ${title}`);
      steps.push(`9b. Current URL: ${page.url()}`);

      const bodyText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
      steps.push(`10. Body text length: ${bodyText?.length || 0}`);
      steps.push(`11. First 500 chars: ${(bodyText || "").slice(0, 500)}`);
    } else {
      steps.push("7e. Could not find search input, dumping page inputs...");
      const allInputs = await page.locator("input").count();
      steps.push(`7f. Total inputs on page: ${allInputs}`);
      for (let i = 0; i < Math.min(allInputs, 8); i++) {
        const inp = page.locator("input").nth(i);
        const placeholder = await inp.getAttribute("placeholder").catch(() => "");
        const ariaLabel = await inp.getAttribute("aria-label").catch(() => "");
        const id = await inp.getAttribute("id").catch(() => "");
        const vis = await inp.isVisible().catch(() => false);
        steps.push(`  input[${i}]: id="${id}" placeholder="${placeholder}" aria-label="${ariaLabel}" visible=${vis}`);
      }
    }

    await browser.close();
    steps.push("11. Browser closed. SUCCESS!");

    return NextResponse.json({ success: true, steps });
  } catch (e) {
    steps.push(`ERROR: ${String(e)}`);
    return NextResponse.json({ success: false, steps, error: String(e) }, { status: 500 });
  }
}
