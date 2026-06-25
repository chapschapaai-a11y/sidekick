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

    steps.push("6. Searching for restaurant...");
    const searchInput = page.locator('#home-autocomplete-input, input[placeholder*="Location, Restaurant"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    steps.push(`6b. Search input visible: ${searchVisible}`);

    if (searchVisible) {
      await searchInput.click();
      await searchInput.fill("Ledger Salem MA");
      await page.waitForTimeout(2000);

      const suggestions = await page.locator('[role="option"], [role="listbox"] li, [class*="suggestion"], [class*="autocomplete"] a, [class*="SearchSuggestion"]').count();
      steps.push(`6c. Autocomplete suggestions: ${suggestions}`);

      if (suggestions > 0) {
        const firstSuggestion = page.locator('[role="option"], [role="listbox"] li, [class*="suggestion"], [class*="autocomplete"] a, [class*="SearchSuggestion"]').first();
        const suggestionText = await firstSuggestion.textContent({ timeout: 2000 }).catch(() => "");
        steps.push(`6d. First suggestion: ${(suggestionText || "").slice(0, 100)}`);
        await firstSuggestion.click();
        await page.waitForTimeout(4000);
      } else {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4000);
      }

      const title = await page.title().catch(() => "unknown");
      steps.push(`7. Page title after search: ${title}`);
      steps.push(`7b. Current URL: ${page.url()}`);

      const bodyText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
      steps.push(`8. Body text length: ${bodyText?.length || 0}`);
      steps.push(`9. First 500 chars: ${(bodyText || "").slice(0, 500)}`);
    } else {
      steps.push("6e. Could not find search input, trying all inputs...");
      const allInputs = await page.locator("input").count();
      steps.push(`6f. Total inputs on page: ${allInputs}`);
      for (let i = 0; i < Math.min(allInputs, 5); i++) {
        const inp = page.locator("input").nth(i);
        const placeholder = await inp.getAttribute("placeholder").catch(() => "");
        const ariaLabel = await inp.getAttribute("aria-label").catch(() => "");
        const id = await inp.getAttribute("id").catch(() => "");
        steps.push(`  input[${i}]: id="${id}" placeholder="${placeholder}" aria-label="${ariaLabel}"`);
      }
    }

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
