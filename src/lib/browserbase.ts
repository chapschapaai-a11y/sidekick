import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});

export async function createBrowserSession(contextId?: string) {
  const browserSettings: Record<string, unknown> = {
    solveCaptchas: true,
    blockAds: true,
  };

  if (contextId) {
    browserSettings.context = { id: contextId, persist: true };
  }

  const sessionOptions: Record<string, unknown> = {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings,
    proxies: true,
    timeout: 900, // long agent tasks (food ordering) need more than the 5-min project default
  };

  const session = await bb.sessions.create(sessionOptions);

  const browser = await chromium.connectOverCDP(session.connectUrl!);
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  });

  return { browser, page, sessionId: session.id };
}

export interface ProductResult {
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  vendor: string;
  format?: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  total: number;
  description: string;
  vendor: string;
  error?: string;
}

export async function searchAmazonProduct(query: string): Promise<ProductResult[]> {
  const { browser, page } = await createBrowserSession();

  try {
    await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeout: 30000 });

    const searchBox = page.locator('#twotabsearchtextbox');
    await searchBox.fill(query);
    await searchBox.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });

    const results: ProductResult[] = [];
    const items = page.locator('[data-component-type="s-search-result"]');
    const count = Math.min(await items.count(), 5);

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      try {
        const title =
          await item.locator('[data-cy="title-recipe"] .a-text-normal').first().textContent({ timeout: 3000 }).catch(() => null) ||
          await item.locator("h2 span").first().textContent({ timeout: 3000 }).catch(() => null) ||
          await item.locator("h2").first().textContent({ timeout: 3000 }).catch(() => "");

        const priceWhole = await item.locator(".a-price .a-price-whole").first().textContent({ timeout: 3000 }).catch(() => "0");
        const priceFraction = await item.locator(".a-price .a-price-fraction").first().textContent({ timeout: 3000 }).catch(() => "00");
        const price = parseFloat(`${(priceWhole || "0").replace(",", "").replace(".", "")}.${priceFraction || "00"}`);

        const asin = await item.getAttribute("data-asin") || "";
        const url = asin ? `https://www.amazon.com/dp/${asin}` : "";

        const imageUrl = await item.locator("img.s-image").first().getAttribute("src", { timeout: 3000 }).catch(() => undefined);

        if (title && price > 0 && url) {
          results.push({ title: title.trim(), price, url, imageUrl: imageUrl || undefined, vendor: "Amazon" });
        }
      } catch {
        continue;
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}

export interface MenuItem {
  name: string;
  price: number;
  description?: string;
}

export interface RestaurantResult {
  name: string;
  url: string;
  rating?: string;
  deliveryFee?: string;
  deliveryTime?: string;
}

export async function searchDoorDashRestaurants(query: string, location: string): Promise<RestaurantResult[]> {
  const { browser, page } = await createBrowserSession();

  try {
    const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?pickup=false`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const addressInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"], input[aria-label*="address"], input[data-testid*="Address"]').first();
    if (await addressInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addressInput.click();
      await addressInput.fill(location);
      await page.waitForTimeout(2000);
      const suggestion = page.locator('[role="option"], [data-testid*="Suggestion"], li[class*="suggestion"]').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(3000);

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);
    }

    const results: RestaurantResult[] = [];
    const storeLinks = page.locator('a[href*="/store/"]');
    const linkCount = await storeLinks.count();
    const seen = new Set<string>();

    for (let i = 0; i < linkCount && results.length < 5; i++) {
      try {
        const link = storeLinks.nth(i);
        const href = await link.getAttribute("href") || "";
        if (!href.includes("/store/") || seen.has(href)) continue;
        seen.add(href);

        const nameEl = link.locator("span, h2, h3, p").first();
        const name = await nameEl.textContent({ timeout: 2000 }).catch(() => "");
        if (!name || name.trim().length < 2 || name.trim().length > 80) continue;

        const cardText = await link.textContent({ timeout: 2000 }).catch(() => "");

        let rating: string | undefined;
        const ratingMatch = cardText?.match(/(\d\.\d)\s/);
        if (ratingMatch) rating = ratingMatch[1];

        let deliveryFee: string | undefined;
        const feeMatch = cardText?.match(/\$(\d+\.?\d*)\s*delivery/i);
        if (feeMatch) deliveryFee = `$${feeMatch[1]}`;

        let deliveryTime: string | undefined;
        const timeMatch = cardText?.match(/(\d+[-–]\d+)\s*min/i);
        if (timeMatch) deliveryTime = `${timeMatch[1]} min`;

        const url = href.startsWith("http") ? href : `https://www.doordash.com${href}`;
        results.push({ name: name.trim(), url, rating, deliveryFee, deliveryTime });
      } catch {
        continue;
      }
    }

    if (results.length === 0) {
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} delivery near ${location} site:doordash.com`)}`;
      await page.goto(googleUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(2000);

      const googleLinks = page.locator('a[href*="doordash.com/store/"]');
      const gCount = Math.min(await googleLinks.count(), 5);

      for (let i = 0; i < gCount; i++) {
        try {
          const link = googleLinks.nth(i);
          const href = await link.getAttribute("href") || "";
          const text = await link.textContent({ timeout: 2000 }).catch(() => "");
          if (!text || !href) continue;

          const cleanName = text.split(" - ")[0].split(" | ")[0].trim();
          if (cleanName.length < 3 || cleanName.length > 80 || seen.has(href)) continue;
          seen.add(href);

          results.push({ name: cleanName, url: href, vendor: "DoorDash" } as RestaurantResult & { vendor?: string });
        } catch {
          continue;
        }
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}

export async function browseDoorDashMenu(restaurantUrl: string, location?: string): Promise<{ restaurantName: string; items: MenuItem[] }> {
  const { browser, page } = await createBrowserSession();

  try {
    await page.goto(restaurantUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const addressInput = page.locator('input[placeholder*="address"], input[placeholder*="Address"], input[aria-label*="address"], input[data-testid*="Address"]').first();
    if (await addressInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const addr = location || "Salem, MA";
      await addressInput.click();
      await addressInput.fill(addr);
      await page.waitForTimeout(2000);
      const suggestion = page.locator('[role="option"], [data-testid*="Suggestion"], li[class*="suggestion"]').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(3000);
    }

    const saveButton = page.locator('button:has-text("Save"), button:has-text("Done"), button:has-text("Confirm"), button[data-testid*="save"]').first();
    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click();
      await page.waitForTimeout(2000);
    }

    const restaurantName = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => "Restaurant");

    const items: MenuItem[] = [];
    const seen = new Set<string>();

    const pageText = await page.textContent("body", { timeout: 5000 }).catch(() => "");
    const itemPattern = /([A-Z][A-Za-z\s&'.,()-]{2,50})\s*\$(\d+\.?\d{0,2})/g;
    let match;
    while ((match = itemPattern.exec(pageText || "")) !== null && items.length < 10) {
      const name = match[1].trim();
      const price = parseFloat(match[2]);
      if (price >= 1 && price <= 200 && name.length >= 3 && !seen.has(name)) {
        seen.add(name);
        items.push({ name, price });
      }
    }

    if (items.length === 0) {
      const menuItems = page.locator('[data-testid="MenuItem"], [data-testid="StoreMenuItem"], button[class*="MenuItem"], div[class*="MenuItem"], [data-anchor-id*="MenuItem"]');
      const count = await menuItems.count();

      for (let i = 0; i < count && items.length < 10; i++) {
        try {
          const item = menuItems.nth(i);
          const text = await item.textContent({ timeout: 2000 }).catch(() => "");
          if (!text) continue;

          const priceMatch = text.match(/\$(\d+\.?\d{0,2})/);
          const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

          const nameEl = item.locator("span, h3, p").first();
          const itemName = await nameEl.textContent({ timeout: 2000 }).catch(() => "");
          if (!itemName || itemName.trim().length < 3 || seen.has(itemName.trim())) continue;
          seen.add(itemName.trim());

          items.push({ name: itemName.trim(), price });
        } catch {
          continue;
        }
      }
    }

    if (items.length === 0) {
      const allElements = page.locator('button, div[role="button"], [class*="item"], [class*="Item"]');
      const elCount = await allElements.count();
      for (let i = 0; i < elCount && items.length < 10; i++) {
        try {
          const el = allElements.nth(i);
          const text = await el.textContent({ timeout: 1000 }).catch(() => "");
          if (!text) continue;
          const priceMatch = text.match(/\$(\d+\.?\d{0,2})/);
          if (!priceMatch) continue;
          const price = parseFloat(priceMatch[1]);
          if (price < 1 || price > 200) continue;
          const nameText = text.split("$")[0].trim().split("\n")[0].trim();
          if (!nameText || nameText.length < 3 || nameText.length > 80 || seen.has(nameText)) continue;
          seen.add(nameText);
          items.push({ name: nameText, price });
        } catch {
          continue;
        }
      }
    }

    return { restaurantName: (restaurantName || "").trim(), items };
  } finally {
    await browser.close();
  }
}

export async function addDoorDashToCart(restaurantUrl: string, itemName: string): Promise<OrderResult> {
  const { browser, page } = await createBrowserSession();

  try {
    await page.goto(restaurantUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const restaurantName = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => "Restaurant");

    const itemButton = page.locator(`button:has-text("${itemName}"), div[role="button"]:has-text("${itemName}"), [data-testid="MenuItem"]:has-text("${itemName}")`).first();

    if (await itemButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await itemButton.click();
      await page.waitForTimeout(2000);

      const itemText = await page.textContent("body", { timeout: 3000 }).catch(() => "");
      const priceMatch = itemText?.match(/\$(\d+\.?\d{0,2})/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

      const addButton = page.locator('button:has-text("Add to Cart"), button:has-text("Add to Order"), button:has-text("Add Item"), button[data-testid*="AddToCart"], button[data-testid*="add"]').first();

      if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await addButton.click();
        await page.waitForTimeout(2000);

        return {
          success: true,
          total: price,
          description: itemName,
          vendor: `DoorDash — ${(restaurantName || "").trim()}`,
        };
      }

      return {
        success: false,
        total: price,
        description: itemName,
        vendor: `DoorDash — ${(restaurantName || "").trim()}`,
        error: "Could not find Add to Cart button on the item page",
      };
    }

    return {
      success: false,
      total: 0,
      description: itemName,
      vendor: `DoorDash — ${(restaurantName || "").trim()}`,
      error: `Could not find "${itemName}" on the menu`,
    };
  } finally {
    await browser.close();
  }
}

export interface RideOption {
  type: string;
  price: string;
  eta?: string;
  duration?: string;
}

export interface RideSearchResult {
  pickup: string;
  dropoff: string;
  options: RideOption[];
  deepLink: string;
}

export async function searchRides(pickup: string, dropoff: string): Promise<RideSearchResult> {
  const { browser, page } = await createBrowserSession();

  try {
    await page.goto("https://www.uber.com/global/en/price-estimate/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const pickupInput = page.locator('input[placeholder*="pickup"], input[placeholder*="Pick-up"], input[aria-label*="pickup"], input[aria-label*="Pick-up"], input[id*="pickup"], input[name*="pickup"]').first();
    const dropoffInput = page.locator('input[placeholder*="drop"], input[placeholder*="Drop"], input[aria-label*="drop"], input[aria-label*="Drop"], input[id*="drop"], input[name*="drop"], input[placeholder*="destination"], input[aria-label*="destination"]').first();

    if (await pickupInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pickupInput.click();
      await pickupInput.fill(pickup);
      await page.waitForTimeout(2000);
      const pickupSuggestion = page.locator('[role="option"], [data-testid*="suggestion"], li[class*="suggestion"], [class*="Suggestion"]').first();
      if (await pickupSuggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pickupSuggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(1500);
    }

    if (await dropoffInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dropoffInput.click();
      await dropoffInput.fill(dropoff);
      await page.waitForTimeout(2000);
      const dropoffSuggestion = page.locator('[role="option"], [data-testid*="suggestion"], li[class*="suggestion"], [class*="Suggestion"]').first();
      if (await dropoffSuggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dropoffSuggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(3000);
    }

    const searchButton = page.locator('button:has-text("See prices"), button:has-text("Search"), button:has-text("Get a price"), button[type="submit"]').first();
    if (await searchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchButton.click();
      await page.waitForTimeout(5000);
    }

    const options: RideOption[] = [];
    const seen = new Set<string>();

    const pageText = await page.textContent("body", { timeout: 5000 }).catch(() => "");

    const ridePattern = /(UberX|UberXL|Uber Comfort|Comfort|UberXL|Uber Black|Black|Uber Green|Green|UberPool|Pool|Uber Share|Share|UberX Share|Lyft|Lyft XL|Lyft Lux)\s*[\s\S]{0,100}?\$(\d+\.?\d{0,2})(?:\s*[-–]\s*\$?(\d+\.?\d{0,2}))?/gi;
    let match;
    while ((match = ridePattern.exec(pageText || "")) !== null && options.length < 8) {
      const type = match[1].trim();
      if (seen.has(type.toLowerCase())) continue;
      seen.add(type.toLowerCase());
      const price = match[3] ? `$${match[2]}-${match[3]}` : `$${match[2]}`;
      options.push({ type, price });
    }

    if (options.length === 0) {
      const rideCards = page.locator('[data-testid*="ride"], [data-testid*="product"], [class*="ProductCard"], [class*="ride-option"], [class*="RideOption"]');
      const cardCount = await rideCards.count();

      for (let i = 0; i < cardCount && options.length < 8; i++) {
        try {
          const card = rideCards.nth(i);
          const text = await card.textContent({ timeout: 2000 }).catch(() => "");
          if (!text) continue;

          const priceMatch = text.match(/\$(\d+\.?\d{0,2})(?:\s*[-–]\s*\$?(\d+\.?\d{0,2}))?/);
          if (!priceMatch) continue;

          const price = priceMatch[2] ? `$${priceMatch[1]}-${priceMatch[2]}` : `$${priceMatch[1]}`;
          const nameEl = card.locator("span, h3, p, div").first();
          const name = await nameEl.textContent({ timeout: 1000 }).catch(() => "");
          if (!name || name.trim().length < 2 || seen.has(name.trim().toLowerCase())) continue;
          seen.add(name.trim().toLowerCase());

          const etaMatch = text.match(/(\d+)\s*min/i);
          options.push({
            type: name.trim(),
            price,
            eta: etaMatch ? `${etaMatch[1]} min` : undefined,
          });
        } catch {
          continue;
        }
      }
    }

    if (options.length === 0) {
      const allText = pageText || "";
      const priceMatches = [...allText.matchAll(/\$(\d+\.?\d{0,2})/g)];
      const rideTypes = ["UberX", "Comfort", "UberXL", "Black"];
      for (let i = 0; i < Math.min(priceMatches.length, 4); i++) {
        options.push({
          type: rideTypes[i] || `Option ${i + 1}`,
          price: `$${priceMatches[i][1]}`,
        });
      }
    }

    const deepLink = `https://m.uber.com/ul/?action=setPickup&pickup[formatted_address]=${encodeURIComponent(pickup)}&dropoff[formatted_address]=${encodeURIComponent(dropoff)}`;

    return { pickup, dropoff, options, deepLink };
  } finally {
    await browser.close();
  }
}

export async function searchLyftRides(pickup: string, dropoff: string): Promise<RideSearchResult> {
  const { browser, page } = await createBrowserSession();

  try {
    const lyftUrl = `https://www.lyft.com/rider/cost-estimate?pickup=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}`;
    await page.goto(lyftUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const options: RideOption[] = [];
    const seen = new Set<string>();
    const pageText = await page.textContent("body", { timeout: 5000 }).catch(() => "");

    const lyftPattern = /(Lyft|Lyft XL|Lyft Lux|Lyft Lux Black|Lyft Lux Black XL|Standard|Priority|Wait & Save|Shared|XL)\s*[\s\S]{0,120}?\$(\d+\.?\d{0,2})(?:\s*[-–]\s*\$?(\d+\.?\d{0,2}))?/gi;
    let match;
    while ((match = lyftPattern.exec(pageText || "")) !== null && options.length < 6) {
      const type = match[1].trim();
      if (seen.has(type.toLowerCase())) continue;
      seen.add(type.toLowerCase());
      const price = match[3] ? `$${match[2]}-${match[3]}` : `$${match[2]}`;
      options.push({ type: `Lyft ${type === "Lyft" ? "" : type}`.trim(), price });
    }

    if (options.length === 0) {
      const rideCards = page.locator('[data-testid*="ride"], [class*="RideOption"], [class*="ride-type"], [class*="product"]');
      const count = await rideCards.count();
      for (let i = 0; i < count && options.length < 6; i++) {
        try {
          const card = rideCards.nth(i);
          const text = await card.textContent({ timeout: 2000 }).catch(() => "");
          if (!text) continue;
          const priceMatch = text.match(/\$(\d+\.?\d{0,2})/);
          if (!priceMatch) continue;
          const nameEl = card.locator("span, h3, p").first();
          const name = await nameEl.textContent({ timeout: 1000 }).catch(() => "");
          if (!name || seen.has(name.trim().toLowerCase())) continue;
          seen.add(name.trim().toLowerCase());
          options.push({ type: name.trim(), price: `$${priceMatch[1]}` });
        } catch {
          continue;
        }
      }
    }

    const deepLink = `https://ride.lyft.com/?pickup[address]=${encodeURIComponent(pickup)}&destination[address]=${encodeURIComponent(dropoff)}`;

    return { pickup, dropoff, options, deepLink };
  } finally {
    await browser.close();
  }
}

export interface BrowseResult {
  success: boolean;
  summary: string;
  currentUrl: string;
  pageTitle: string;
  error?: string;
}

interface BrowserAction {
  action: "click" | "type" | "navigate" | "select" | "scroll" | "scroll_up" | "press_key" | "wait" | "done" | "fail";
  selector?: string;
  text?: string;
  url?: string;
  summary: string;
}

export async function browseWebsite(
  url: string,
  task: string,
  autofill?: { name?: string; email?: string; phone?: string; address?: string },
  contextId?: string,
  paymentCard?: { number: string; expMonth: number; expYear: number; cvc: string },
  options?: { allowFinalSubmit?: boolean; openTableSearch?: string; deadlineMs?: number },
): Promise<BrowseResult> {
  const anthropic = new Anthropic();
  const browseStart = Date.now();
  console.error("[BROWSE:1] Creating browser session...");
  const handles = await createBrowserSession(contextId);
  const browser = handles.browser;
  const sessionId = handles.sessionId;
  let page = handles.page;
  console.error("[BROWSE:2] Session created:", sessionId);

  try {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      console.error("[BROWSE:3] Page loaded (domcontentloaded):", url);
    } catch (navErr) {
      console.error("[BROWSE:3] domcontentloaded failed, trying commit:", String(navErr).slice(0, 100));
      await page.goto(url, { waitUntil: "commit", timeout: 15000 });
      console.error("[BROWSE:3b] Page loaded (commit)");
    }
    await page.waitForTimeout(3000);

    if (url === "https://www.opentable.com") {
      // Wait for the page to fully render — OpenTable is a SPA that loads slowly
      await page.waitForTimeout(5000);

      const cookieBtn = page.locator('#onetrust-accept-btn-handler').first();
      if (await cookieBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await cookieBtn.click();
        console.error("[BROWSE:3c] Cookie banner dismissed");
        await page.waitForTimeout(1500);
      } else {
        console.error("[BROWSE:3c] No cookie banner found");
      }

      if (options?.openTableSearch) {
        console.error("[BROWSE:3d] Scripted OpenTable search for:", options.openTableSearch);
        // Try multiple selectors for the search input
        const searchSelectors = [
          '#home-autocomplete-input',
          'input[placeholder*="Location, Restaurant"]',
          'input[placeholder*="restaurant"]',
          'input[aria-label*="search"]',
          'input[data-test*="search"]',
          'input[type="search"]',
        ];
        let searchInput = null;
        for (const sel of searchSelectors) {
          try {
            await page.waitForSelector(sel, { state: "visible", timeout: 3000 });
            searchInput = page.locator(sel).first();
            console.error("[BROWSE:3d2] Found search input with:", sel);
            break;
          } catch {
            continue;
          }
        }
        if (!searchInput) {
          console.error("[BROWSE:3d2] No search input found with any selector");
        }
        if (searchInput) {
          await searchInput.click();
          await page.waitForTimeout(500);
          // Use keyboard.type instead of fill to trigger autocomplete events
          await page.keyboard.type(options.openTableSearch, { delay: 50 });
          console.error("[BROWSE:3e] Typed search query, waiting for suggestions...");
          await page.waitForTimeout(4000);

          // Try multiple selector strategies for OpenTable's autocomplete dropdown
          const suggestionSelectors = [
            '[data-test*="restaurant"] a',
            '[data-test*="autocomplete"] a',
            'a[href*="/r/"]',
            '[role="listbox"] [role="option"]',
            '[class*="SearchSuggestion"] a',
            '[class*="autocomplete"] [role="option"]',
            '[class*="suggestion"]',
            'li a[href*="/r/"]',
          ];

          let restaurantHref: string | null = null;
          let clicked = false;
          for (const sel of suggestionSelectors) {
            const suggestion = page.locator(sel).first();
            if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
              // Extract the href before clicking — we may need it for a retry
              restaurantHref = await suggestion.getAttribute("href").catch(() => null);
              await suggestion.click();
              console.error("[BROWSE:3f] Clicked suggestion with selector:", sel, "href:", restaurantHref);
              clicked = true;
              await page.waitForTimeout(5000);
              break;
            }
          }

          // Check if we landed on "Access Denied" after clicking
          const postClickTitle = await page.title().catch(() => "");
          if (postClickTitle.includes("Access Denied") || postClickTitle.includes("Denied")) {
            console.error("[BROWSE:3g] Access Denied after click. Trying Google referrer approach...");
            // Navigate via Google as referrer — Akamai often whitelists Google
            const slug = restaurantHref || `/r/${options.openTableSearch.split(" ")[0].toLowerCase()}`;
            const fullUrl = slug.startsWith("http") ? slug : `https://www.opentable.com${slug}`;
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(options.openTableSearch + " opentable")}`, {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });
            await page.waitForTimeout(2000);
            // Click the OpenTable result from Google
            const googleResult = page.locator('a[href*="opentable.com/r/"]').first();
            if (await googleResult.isVisible({ timeout: 5000 }).catch(() => false)) {
              await googleResult.click();
              console.error("[BROWSE:3h] Clicked OpenTable link from Google search");
              await page.waitForTimeout(5000);
            } else {
              // Direct navigate with referrer
              await page.setExtraHTTPHeaders({ "Referer": "https://www.google.com/" });
              await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
              console.error("[BROWSE:3h] Direct navigate with Google referer to:", fullUrl);
              await page.waitForTimeout(3000);
            }
          }

          if (!clicked) {
            console.error("[BROWSE:3f] No suggestion matched, leaving for AI agent");
          }
        }
      } else {
        const searchInput = page.locator('#home-autocomplete-input').first();
        if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await searchInput.click();
          console.error("[BROWSE:3d] Search input clicked and focused");
          await page.waitForTimeout(500);
        }
      }
    }

    const pageContent = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
    console.error("[BROWSE:4] Page content length:", pageContent?.trim().length || 0, "title:", await page.title().catch(() => "?"));
    if (!pageContent || pageContent.trim().length < 50) {
      console.error("[BROWSE:4b] Short content, waiting 5s more...");
      await page.waitForTimeout(5000);
    }

    const autofillInfo = autofill
      ? `\nUSER INFO (use to fill forms):\n- Name: ${autofill.name || "not provided"}\n- Email: ${autofill.email || "not provided"}\n- Phone: ${autofill.phone || "not provided"}\n- Address: ${autofill.address || "not provided"}`
      : "";

    const paymentInfo = paymentCard
      ? `\nPAYMENT CARD (use at checkout):\n- Card number: ${paymentCard.number}\n- Expiry: ${String(paymentCard.expMonth).padStart(2, "0")}/${paymentCard.expYear}\n- CVC: ${paymentCard.cvc}\n- Name on card: ${autofill?.name || "Sidekick User"}`
      : "";

    const conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
    const MAX_STEPS = 30;

    for (let step = 0; step < MAX_STEPS; step++) {
      // Wrap up before the serverless function gets killed mid-order — an honest
      // failure with context beats a silent 504.
      if (options?.deadlineMs && Date.now() - browseStart > options.deadlineMs) {
        console.error("[BROWSE:DEADLINE] Out of time at step", step);
        return {
          success: false,
          summary: `Ran out of time after ${step} steps. The task was still in progress and no final action was taken.`,
          currentUrl: page.url(),
          pageTitle: await page.title().catch(() => ""),
          error: "deadline-exceeded",
        };
      }

      // Sites like DoorDash sometimes close the current target and continue in a
      // new one — recover by switching to the newest live page instead of dying.
      if (page.isClosed()) {
        const livePages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.isClosed());
        if (livePages.length === 0) {
          throw new Error("Browser session ended unexpectedly (all pages closed)");
        }
        page = livePages[livePages.length - 1];
        console.error("[BROWSE:RECOVER] Page was closed — switched to newest live page:", page.url());
        await page.waitForTimeout(1500).catch(() => {});
      }

      const title = await page.title().catch(() => "");
      const currentUrl = page.url();

      // Scan all interactive elements in ONE page round-trip (the old per-element
      // locator approach made hundreds of CDP calls and blew the session timeout).
      // Each visible element gets tagged with data-sk-idx so actions can target it.
      const interactiveElements: string[] = await page.evaluate(() => {
        const els = document.querySelectorAll(
          "a, button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='option'], [role='checkbox'], [role='radio']"
        );
        const out: string[] = [];
        let idx = 0;
        for (const node of Array.from(els)) {
          if (out.length >= 80) break;
          const el = node as HTMLElement;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const style = getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") continue;

          el.setAttribute("data-sk-idx", String(idx));
          const input = el as HTMLInputElement;
          const label = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
          const href = el.getAttribute("href") || "";
          const desc = [
            el.tagName.toLowerCase(),
            input.type ? `type=${input.type}` : "",
            el.id ? `id="${el.id}"` : "",
            input.name ? `name="${input.name}"` : "",
            el.getAttribute("placeholder") ? `placeholder="${el.getAttribute("placeholder")}"` : "",
            el.getAttribute("aria-label") ? `aria-label="${el.getAttribute("aria-label")}"` : "",
            href ? `href="${href.slice(0, 80)}"` : "",
            label ? `"${label}"` : "",
            input.value && input.tagName !== "BUTTON" ? `value="${String(input.value).slice(0, 50)}"` : "",
            input.checked === true ? "checked" : "",
          ].filter(Boolean).join(" ");
          out.push(`[${idx}] ${desc}`);
          idx++;
        }
        return out;
      }).catch(() => [] as string[]);

      const pageText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
      const visibleText = (pageText || "").replace(/\s+/g, " ").trim().slice(0, 3000);

      const userMessage = `CURRENT PAGE (step ${step + 1}/${MAX_STEPS}):
URL: ${currentUrl}
Title: ${title}

PAGE CONTENT (first 3000 chars):
${visibleText}

INTERACTIVE ELEMENTS:
${interactiveElements.slice(0, 50).join("\n")}`;

      const systemPrompt = `You are a browser automation agent. You take ONE action per response.

CRITICAL: Your ENTIRE response must be a single JSON object. No text before or after it. No markdown. No explanation. ONLY JSON.

TASK: ${task}
${autofillInfo}${paymentInfo}

RULES:
1. Your response must be ONLY a valid JSON object — nothing else.
2. Format: {"action": "click|type|navigate|select|scroll|scroll_up|press_key|wait|done|fail", "selector": "[index]", "text": "for type/press_key", "url": "for navigate", "summary": "brief description"}
3. Use element index like [3] from the INTERACTIVE ELEMENTS list.
4. To type into a field, first click it in one step, then type in the next step.
5. For dropdowns/selects, use "select" with the option text.
6. Use "press_key" with text like "Enter", "Tab", "Escape" for keyboard actions.
7. Use "scroll" to scroll down, "scroll_up" to scroll up — useful when the element you need isn't visible.
8. Handle cookie banners, popups, and modals by dismissing/accepting them.
9. ${options?.allowFinalSubmit ? 'You ARE allowed to click final confirm/submit/complete buttons (like "Complete reservation", "Confirm booking", etc.). Click them and report success.' : 'DO NOT click "Place Order" or "Submit Order" or any final purchase button. Stop BEFORE that and use "done" with a summary of what\'s in the cart and the total price.'}
10. If a page requires login/signup, report "fail" — don't try to create accounts.
11. Be persistent — if an action fails, try an alternative approach. Scroll to find elements, try different selectors.
12. For address fields, type the full address. If autocomplete suggestions appear, click the best match.
13. If you see a price total or order summary, include it in your "done" summary.`;

      if (conversationHistory.length === 0) {
        conversationHistory.push({ role: "user", content: userMessage });
      } else {
        conversationHistory.push({ role: "user", content: userMessage });
      }

      // Keep conversation history manageable — last 10 exchanges
      const recentHistory = conversationHistory.slice(-20);

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: systemPrompt,
        messages: recentHistory,
      });

      const actionText = response.content[0].type === "text" ? response.content[0].text : "";
      conversationHistory.push({ role: "assistant", content: actionText });

      let browserAction: BrowserAction;
      try {
        const cleaned = actionText.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        browserAction = JSON.parse(cleaned);
      } catch {
        const jsonMatch = actionText.match(/\{[\s\S]*"action"\s*:\s*"[^"]+[\s\S]*\}/);
        if (jsonMatch) {
          try {
            browserAction = JSON.parse(jsonMatch[0]);
          } catch {
            console.error(`[BROWSE:STEP:${step}] Failed to parse AI response:`, actionText.slice(0, 200));
            conversationHistory.push({ role: "user", content: "RESPOND WITH ONLY A JSON OBJECT. No explanation, no prose. Just {\"action\": \"...\", \"summary\": \"...\"}." });
            continue;
          }
        } else {
          console.error(`[BROWSE:STEP:${step}] Failed to parse AI response:`, actionText.slice(0, 200));
          conversationHistory.push({ role: "user", content: "RESPOND WITH ONLY A JSON OBJECT. No explanation, no prose. Just {\"action\": \"...\", \"summary\": \"...\"}." });
          continue;
        }
      }

      console.error(`[BROWSE:STEP:${step}] Action: ${browserAction.action} | ${browserAction.summary || ""} | selector: ${browserAction.selector || "none"}`);

      if (browserAction.action === "done") {
        return {
          success: true,
          summary: browserAction.summary,
          currentUrl: page.url(),
          pageTitle: await page.title().catch(() => ""),
        };
      }

      if (browserAction.action === "fail") {
        return {
          success: false,
          summary: browserAction.summary,
          currentUrl: page.url(),
          pageTitle: await page.title().catch(() => ""),
          error: browserAction.summary,
        };
      }

      try {
        const idxSelector = (() => {
          const m = browserAction.selector?.match(/^\[(\d+)\]$/);
          return m ? `[data-sk-idx="${m[1]}"]` : null;
        })();

        if (browserAction.action === "navigate" && browserAction.url) {
          await page.goto(browserAction.url, { waitUntil: "domcontentloaded", timeout: 25000 });
          await page.waitForTimeout(2000);
        } else if (browserAction.action === "click") {
          const sel = idxSelector || browserAction.selector;
          if (sel) {
            const loc = page.locator(sel).first();
            try {
              await loc.click({ timeout: 5000 });
            } catch {
              // Overlays (promos, cookie layers) swallow normal clicks — escalate:
              // forced click ignores hit-target checks, JS click bypasses rendering entirely.
              try {
                await loc.click({ timeout: 3000, force: true });
                console.error("[BROWSE:CLICK] normal click blocked — force click worked");
              } catch {
                await loc.evaluate((el) => (el as HTMLElement).click());
                console.error("[BROWSE:CLICK] force click blocked — JS click dispatched");
              }
            }
          }
          await page.waitForTimeout(1500);
        } else if (browserAction.action === "type" && browserAction.text) {
          if (idxSelector) {
            await page.locator(idxSelector).first().fill(browserAction.text);
          } else if (browserAction.selector) {
            await page.locator(browserAction.selector).first().fill(browserAction.text);
          } else {
            await page.keyboard.type(browserAction.text);
          }
          await page.waitForTimeout(800);
        } else if (browserAction.action === "select" && browserAction.selector && browserAction.text) {
          if (idxSelector) {
            await page.locator(idxSelector).first().selectOption({ label: browserAction.text });
          } else if (browserAction.selector) {
            await page.locator(browserAction.selector).first().selectOption({ label: browserAction.text });
          }
          await page.waitForTimeout(800);
        } else if (browserAction.action === "scroll") {
          await page.mouse.wheel(0, 600);
          await page.waitForTimeout(1000);
        } else if (browserAction.action === "scroll_up") {
          await page.mouse.wheel(0, -600);
          await page.waitForTimeout(1000);
        } else if (browserAction.action === "press_key" && browserAction.text) {
          await page.keyboard.press(browserAction.text);
          await page.waitForTimeout(800);
        } else if (browserAction.action === "wait") {
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        conversationHistory.push({
          role: "user",
          content: `ACTION FAILED: ${String(e).slice(0, 200)}. Try a different approach.`,
        });
        conversationHistory.push({
          role: "assistant",
          content: `{"action": "wait", "summary": "Retrying after error"}`,
        });
        // page may have died mid-action — never let the recovery wait itself throw
        await page.waitForTimeout(1000).catch(() => {});
      }
    }

    return {
      success: false,
      summary: "Reached maximum steps. The order may be partially complete — check the website.",
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
      error: "Reached maximum steps without completing the task",
    };
  } finally {
    await browser.close();
  }
}

export interface OpenTableSlot {
  time: string;
  slotHash: string;
  availabilityToken: string;
  type: string;
}

export interface OpenTableSearchResult {
  restaurantId: number;
  restaurantName: string;
  slots: OpenTableSlot[];
  date: string;
  partySize: number;
}

export async function completeOpenTableReservation(
  restaurantQuery: string,
  date: string,
  time: string,
  partySize: number,
  diner: { firstName: string; lastName: string; email: string; phone: string },
  seatingPreference?: string,
): Promise<BrowseResult> {
  const anthropic = new Anthropic();
  const { browser, page, sessionId } = await createBrowserSession();
  console.error("[OT-API:1] Session created:", sessionId);

  try {
    try {
      await page.goto("https://www.opentable.com", { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      console.error("[OT-API:2] domcontentloaded timed out, trying commit...");
      try {
        await page.goto("https://www.opentable.com", { waitUntil: "commit", timeout: 15000 });
      } catch {
        console.error("[OT-API:2] commit also failed, continuing anyway...");
      }
    }
    await page.waitForTimeout(5000);
    console.error("[OT-API:2] OpenTable page loaded");

    // Step 1: Search for the restaurant via Autocomplete GraphQL API
    const searchResult = await page.evaluate(async (query: string) => {
      // CSRF token is HttpOnly cookie — read from window global set by OpenTable's JS
      const csrfToken = (window as unknown as Record<string, string>).__CSRF_TOKEN__ || "";
      const res = await fetch("/dapi/fe/gql?optype=query&opname=Autocomplete", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          operationName: "Autocomplete",
          variables: { term: query, latitude: 42.5195, longitude: -70.8967, useNewVersion: true },
          extensions: { persistedQuery: { version: 1, sha256Hash: "fe1d118abd4c227750693027c2414d43014c2493f64f49bcef5a65274ce9c3c3" } },
        }),
      });
      if (!res.ok) return { error: `HTTP ${res.status}`, hasCSRF: !!csrfToken } as { error: string; hasCSRF: boolean };
      const data = await res.json();
      const allResults = data?.data?.autocomplete?.autocompleteResults || [];
      const restaurants = allResults.filter((r: Record<string, string>) => r.type === "Restaurant");
      if (restaurants.length === 0) return null;

      // Find best name match — results aren't ranked by relevance
      const queryLower = query.toLowerCase().replace(/['']/g, "");
      let best = restaurants[0];
      let bestScore = 0;
      for (const r of restaurants) {
        const nameLower = (r.name as string).toLowerCase().replace(/['']/g, "");
        const queryWords = queryLower.split(/\s+/);
        let score = 0;
        for (const word of queryWords) {
          if (nameLower.includes(word)) score += word.length;
        }
        if (nameLower.includes(queryLower)) score += 100;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      return { id: parseInt(best.id as string, 10), name: best.name as string };
    }, restaurantQuery) as { id: number; name: string } | { error: string; hasCSRF: boolean } | null;

    if (!searchResult) {
      console.error("[OT-API:3] No restaurant found for:", restaurantQuery);
      return { success: false, summary: `Could not find "${restaurantQuery}" on OpenTable`, currentUrl: page.url(), pageTitle: "" };
    }
    if ("error" in searchResult) {
      console.error("[OT-API:3] Autocomplete API error:", searchResult.error, "hasCSRF:", searchResult.hasCSRF);
      return { success: false, summary: `OpenTable API error: ${searchResult.error}`, currentUrl: page.url(), pageTitle: "" };
    }
    console.error("[OT-API:3] Found restaurant:", searchResult.name, "ID:", searchResult.id);

    // Step 2: Get availability via RestaurantsAvailability GraphQL API
    const availability = await page.evaluate(async (args: { rid: number; date: string; time: string; partySize: number }) => {
      const csrfToken = (window as unknown as Record<string, string>).__CSRF_TOKEN__ || "";
      const res = await fetch("/dapi/fe/gql?optype=query&opname=RestaurantsAvailability", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          operationName: "RestaurantsAvailability",
          variables: {
            onlyPop: false,
            forwardDays: 0,
            requireTimes: false,
            requireTypes: ["Standard", "Experience"],
            privilegedAccess: [],
            restaurantIds: [args.rid],
            date: args.date,
            time: args.time,
            partySize: args.partySize,
            databaseRegion: "NA",
            forwardMinutes: 210,
            backwardMinutes: 210,
            loyaltyRedemptionTiers: [],
          },
          extensions: { persistedQuery: { version: 1, sha256Hash: "436770d3236803f6bb7e8bdfc7b617a582026235c1a6af52297ab63fed08aa0c" } },
        }),
      });
      const data = await res.json();
      const restaurant = data?.data?.availability?.[0];
      if (!restaurant) return null;
      const slots = restaurant.availabilityDays?.[0]?.slots?.filter((s: { isAvailable: boolean }) => s.isAvailable) || [];
      return {
        restaurantAvailabilityToken: restaurant.restaurantAvailabilityToken,
        slots: slots.map((s: { timeOffsetMinutes: number; slotHash: string; slotAvailabilityToken: string; type: string }) => ({
          offsetMinutes: s.timeOffsetMinutes,
          slotHash: s.slotHash,
          token: s.slotAvailabilityToken,
          type: s.type,
        })),
      };
    }, { rid: searchResult.id, date, time, partySize });

    if (!availability || availability.slots.length === 0) {
      console.error("[OT-API:4] No available slots for", searchResult.name);
      return { success: false, summary: `No available times at ${searchResult.name} for ${partySize} on ${date} near ${time}`, currentUrl: page.url(), pageTitle: "" };
    }

    // Pick the slot closest to requested time (offset 0 = exact match)
    const sorted = [...availability.slots].sort((a: { offsetMinutes: number }, b: { offsetMinutes: number }) => Math.abs(a.offsetMinutes) - Math.abs(b.offsetMinutes));
    const bestSlot = sorted[0];

    // Convert offset to actual time
    const [reqH, reqM] = time.split(":").map(Number);
    const totalMinutes = reqH * 60 + reqM + bestSlot.offsetMinutes;
    const slotH = Math.floor(totalMinutes / 60);
    const slotM = totalMinutes % 60;
    const slotTime = `${String(slotH).padStart(2, "0")}:${String(slotM).padStart(2, "0")}:00`;

    console.error("[OT-API:4] Best slot:", slotTime, "hash:", bestSlot.slotHash, "offset:", bestSlot.offsetMinutes);

    // Step 3: Navigate directly to the booking page (bypasses Akamai WAF on /r/ pages)
    const bookingUrl = `https://www.opentable.com/booking/seating-options?` +
      `availabilityToken=${encodeURIComponent(bestSlot.token)}` +
      `&creditCardRequired=false` +
      `&dateTime=${date}T${slotTime}` +
      `&partySize=${partySize}` +
      `&points=100&pointsType=Standard&resoAttribute=unselected` +
      `&rid=${searchResult.id}` +
      `&slotHash=${bestSlot.slotHash}` +
      `&isModify=false&isMandatory=false&cfe=true&st=${bestSlot.type}`;

    console.error("[OT-API:5] Navigating to booking page...");
    await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    console.error("[OT-API:6] Booking page loaded:", page.url());

    // Step 4: AI agent handles the simple booking form
    const seatingInstruction = seatingPreference
      ? `Select "${seatingPreference}" seating if the option is available.`
      : "Select any available seating option (e.g. Standard / Inside).";

    const conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
    const MAX_STEPS = 15;

    for (let step = 0; step < MAX_STEPS; step++) {
      const title = await page.title().catch(() => "");
      const currentUrl = page.url();

      const interactiveElements: string[] = [];
      const elements = await page.locator("a, button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='option'], [role='checkbox'], [role='radio']").all().catch(() => []);

      for (let i = 0; i < Math.min(elements.length, 80); i++) {
        try {
          const el = elements[i];
          if (!(await el.isVisible().catch(() => false))) continue;
          const tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => "");
          const text = (await el.textContent({ timeout: 500 }).catch(() => "") || "").trim().slice(0, 100);
          const placeholder = await el.getAttribute("placeholder").catch(() => "");
          const ariaLabel = await el.getAttribute("aria-label").catch(() => "");
          const type = await el.getAttribute("type").catch(() => "");
          const name = await el.getAttribute("name").catch(() => "");
          const id = await el.getAttribute("id").catch(() => "");
          const value = await el.inputValue().catch(() => "");
          const checked = await el.isChecked().catch(() => null);
          const desc = [tag, type ? `type=${type}` : "", id ? `id="${id}"` : "", name ? `name="${name}"` : "", placeholder ? `placeholder="${placeholder}"` : "", ariaLabel ? `aria-label="${ariaLabel}"` : "", text ? `"${text}"` : "", value ? `value="${value.slice(0, 50)}"` : "", checked === true ? "checked" : ""].filter(Boolean).join(" ");
          interactiveElements.push(`[${i}] ${desc}`);
        } catch { continue; }
      }

      const pageText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
      const visibleText = (pageText || "").replace(/\s+/g, " ").trim().slice(0, 3000);

      const userMessage = `CURRENT PAGE (step ${step + 1}/${MAX_STEPS}):\nURL: ${currentUrl}\nTitle: ${title}\n\nPAGE CONTENT:\n${visibleText}\n\nINTERACTIVE ELEMENTS:\n${interactiveElements.slice(0, 50).join("\n")}`;
      conversationHistory.push({ role: "user", content: userMessage });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: `You are a browser automation agent completing an OpenTable reservation. Respond with ONLY a JSON object.\n\nBOOKING: ${searchResult.name} | ${date} | ${partySize} people\n\nSTEPS:\n1. If on seating options page: ${seatingInstruction} Click "Select" next to it.\n2. If on details/form page: Fill in First name: ${diner.firstName}, Last name: ${diner.lastName}, Email: ${diner.email}, Phone: ${diner.phone}. Uncheck any marketing checkboxes. Then click "Complete reservation".\n3. If on confirmation page: Return done with confirmation details.\n\nFormat: {"action": "click|type|select|scroll|press_key|wait|done|fail", "selector": "[index]", "text": "...", "summary": "..."}`,
        messages: conversationHistory.slice(-10),
      });

      const actionText = response.content[0].type === "text" ? response.content[0].text : "";
      conversationHistory.push({ role: "assistant", content: actionText });

      let browserAction: BrowserAction;
      try {
        const cleaned = actionText.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        browserAction = JSON.parse(cleaned);
      } catch {
        const jsonMatch = actionText.match(/\{[\s\S]*"action"\s*:\s*"[^"]+[\s\S]*\}/);
        if (jsonMatch) { try { browserAction = JSON.parse(jsonMatch[0]); } catch { continue; } } else { continue; }
      }

      console.error(`[OT-API:STEP:${step}] ${browserAction.action} | ${browserAction.summary || ""}`);

      if (browserAction.action === "done") {
        return { success: true, summary: browserAction.summary, currentUrl: page.url(), pageTitle: await page.title().catch(() => "") };
      }
      if (browserAction.action === "fail") {
        return { success: false, summary: browserAction.summary, currentUrl: page.url(), pageTitle: await page.title().catch(() => ""), error: browserAction.summary };
      }

      try {
        if (browserAction.action === "click") {
          const indexMatch = browserAction.selector?.match(/^\[(\d+)\]$/);
          if (indexMatch && elements[parseInt(indexMatch[1])]) {
            await elements[parseInt(indexMatch[1])].click({ timeout: 5000 });
          }
          await page.waitForTimeout(2000);
        } else if (browserAction.action === "type" && browserAction.text) {
          const indexMatch = browserAction.selector?.match(/^\[(\d+)\]$/);
          if (indexMatch && elements[parseInt(indexMatch[1])]) {
            await elements[parseInt(indexMatch[1])].fill(browserAction.text);
          } else {
            await page.keyboard.type(browserAction.text);
          }
          await page.waitForTimeout(500);
        } else if (browserAction.action === "select" && browserAction.selector && browserAction.text) {
          const indexMatch = browserAction.selector?.match(/^\[(\d+)\]$/);
          if (indexMatch && elements[parseInt(indexMatch[1])]) {
            await elements[parseInt(indexMatch[1])].selectOption({ label: browserAction.text });
          }
          await page.waitForTimeout(500);
        } else if (browserAction.action === "scroll") {
          await page.mouse.wheel(0, 600);
          await page.waitForTimeout(1000);
        } else if (browserAction.action === "press_key" && browserAction.text) {
          await page.keyboard.press(browserAction.text);
          await page.waitForTimeout(500);
        } else if (browserAction.action === "wait") {
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        conversationHistory.push({ role: "user", content: `ACTION FAILED: ${String(e).slice(0, 200)}. Try a different approach.` });
        conversationHistory.push({ role: "assistant", content: `{"action": "wait", "summary": "Retrying after error"}` });
      }
    }

    return { success: false, summary: "Reached maximum steps without completing the booking", currentUrl: page.url(), pageTitle: await page.title().catch(() => ""), error: "Reached maximum steps" };
  } finally {
    await browser.close();
  }
}

export async function addAmazonToCart(productUrl: string): Promise<OrderResult> {
  const { browser, page } = await createBrowserSession();

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const title = await page.locator("#productTitle").textContent({ timeout: 5000 }).catch(() => "Unknown product");

    const priceText = await page.locator(".a-price .a-offscreen").first().textContent({ timeout: 5000 }).catch(() => null);
    const price = priceText ? parseFloat(priceText.replace("$", "").replace(",", "")) : 0;

    const addToCartButton = page.locator("#add-to-cart-button");
    if (await addToCartButton.isVisible({ timeout: 5000 })) {
      await addToCartButton.click();
      await page.waitForTimeout(2000);

      return {
        success: true,
        total: price,
        description: (title || "").trim(),
        vendor: "Amazon",
      };
    }

    return {
      success: false,
      total: price,
      description: (title || "").trim(),
      vendor: "Amazon",
      error: "Could not find Add to Cart button",
    };
  } finally {
    await browser.close();
  }
}
