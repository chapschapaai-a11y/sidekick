import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});

export async function createBrowserSession(contextId?: string) {
  const sessionOpts: Record<string, unknown> = {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
  };

  if (contextId) {
    sessionOpts.browserSettings = {
      context: { id: contextId, persist: true },
    };
  }

  const session = await bb.sessions.create(sessionOpts);

  const browser = await chromium.connectOverCDP(session.connectUrl!);
  const context = browser.contexts()[0];
  const page = context.pages()[0];

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
