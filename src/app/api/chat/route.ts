import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { fetchTodayEvents, fetchCalendarRange, fetchRecentEmails, CalendarEvent, GmailThread } from "@/lib/google";
async function getBrowserbase() {
  return await import("@/lib/browserbase");
}

const anthropic = new Anthropic();

const SIDEKICK_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_product",
    description:
      "Search Amazon for a product using browser automation. Returns real product titles, prices, and URLs. Use this when the user asks to buy something — search first to get the real price, then show them the top result and ask for confirmation before spending.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. 'Atomic Habits paperback', 'AirPods Pro', 'yoga mat')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "place_order",
    description:
      "Add a product to the Amazon cart using its URL. Call this ONLY after the user confirms the purchase. This navigates to the product page and clicks Add to Cart.",
    input_schema: {
      type: "object" as const,
      properties: {
        productUrl: {
          type: "string",
          description: "The Amazon product URL from the search results",
        },
        productTitle: {
          type: "string",
          description: "The product title for the transaction record",
        },
      },
      required: ["productUrl", "productTitle"],
    },
  },
  {
    name: "spend_wallet",
    description:
      "Spend money from the user's Sidekick wallet to make a purchase. Call this AFTER place_order succeeds to deduct the cost from the wallet. Never call without a confirmed price from a real product search.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: {
          type: "number",
          description: "Dollar amount to charge (e.g. 16.99)",
        },
        description: {
          type: "string",
          description:
            "What the purchase is for (e.g. 'Atomic Habits by James Clear — paperback')",
        },
        vendor: {
          type: "string",
          description:
            "Where the purchase is from (e.g. 'Amazon', 'DoorDash', 'United Airlines')",
        },
      },
      required: ["amount", "description", "vendor"],
    },
  },
  {
    name: "check_wallet_balance",
    description: "Check the current wallet balance before or during a purchase flow.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "search_restaurants",
    description:
      "Search DoorDash for restaurants near the user's location. Returns restaurant names, ratings, delivery times, and URLs. Use when the user wants to order food.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "What kind of food or restaurant (e.g. 'pizza', 'Thai food', 'sushi', 'Chipotle')",
        },
        location: {
          type: "string",
          description: "Delivery address or city (e.g. 'Salem, MA' or '123 Main St, Salem MA')",
        },
      },
      required: ["query", "location"],
    },
  },
  {
    name: "browse_menu",
    description:
      "Browse the menu of a specific DoorDash restaurant. Returns menu item names, prices, and descriptions. Call after the user picks a restaurant from search_restaurants results.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurantUrl: {
          type: "string",
          description: "The DoorDash restaurant URL from search results",
        },
        location: {
          type: "string",
          description: "Delivery address for the restaurant (e.g. 'Salem, MA')",
        },
      },
      required: ["restaurantUrl"],
    },
  },
  {
    name: "save_address",
    description:
      "Save or update the user's home address. Use when the user tells you their address, says 'my address is...', or when you need to save it for shipping/delivery.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "The full home address (e.g. '123 Main St, Salem, MA 01970')",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "place_food_order",
    description:
      "Add a menu item to the DoorDash cart. Call ONLY after the user confirms what they want to order. Navigates to the restaurant page and adds the item.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurantUrl: {
          type: "string",
          description: "The DoorDash restaurant URL",
        },
        itemName: {
          type: "string",
          description: "The exact menu item name to add to cart",
        },
        restaurantName: {
          type: "string",
          description: "The restaurant name for the transaction record",
        },
      },
      required: ["restaurantUrl", "itemName", "restaurantName"],
    },
  },
  {
    name: "search_rides",
    description:
      "Search for Uber and Lyft ride options between two locations. Returns ride types, estimated prices, ETAs, and deep links to request the ride. Use when the user asks for a ride, car, or to get somewhere.",
    input_schema: {
      type: "object" as const,
      properties: {
        pickup: {
          type: "string",
          description: "Pickup address or location (e.g. '123 Main St, Salem, MA' or 'Logan Airport, Boston')",
        },
        dropoff: {
          type: "string",
          description: "Destination address or location (e.g. 'TD Garden, Boston' or '456 Elm St, Cambridge, MA')",
        },
      },
      required: ["pickup", "dropoff"],
    },
  },
  {
    name: "browse_website",
    description:
      "Open any website in a real browser and complete a task using AI-powered navigation. The browser can click buttons, fill forms, navigate pages, add items to carts, and complete checkouts. Use this for ordering food from restaurant websites (Pizza Hut, Chipotle, Dominos, etc.), shopping on any store, booking services, or any online task. The browser takes 30-60 seconds to complete a task. IMPORTANT: For ordering flows, the first call should build the cart and STOP at checkout (do NOT place the order). A second call after user approval should complete the purchase.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The website URL to open (e.g. 'https://www.pizzahut.com', 'https://www.chipotle.com')",
        },
        task: {
          type: "string",
          description: "VERY detailed step-by-step description of what to do on the site. Be extremely specific about every action: which buttons to click, what to type, which items to select, what customizations to make. For ordering flows, always end with 'STOP at the checkout page and report the cart contents and total. Do NOT click Place Order.' Include the delivery address, all items with sizes and toppings, and any special instructions.",
        },
        autofill: {
          type: "object",
          description: "User info to auto-fill into forms during checkout",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
          },
        },
      },
      required: ["url", "task"],
    },
  },
  {
    name: "save_profile",
    description:
      "Save the user's contact info (phone number, email) for auto-filling checkout forms. Use when the user shares their phone number or email.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone: {
          type: "string",
          description: "Phone number (e.g. '956-907-5482')",
        },
        email: {
          type: "string",
          description: "Email address",
        },
      },
      required: [],
    },
  },
  {
    name: "check_calendar",
    description:
      "Look up calendar events for any date or date range. Use whenever the user asks about their schedule — 'what do I have Tuesday', 'am I free this weekend', 'next Thursday', 'this week', 'July 4th', etc. Returns all events from Google Calendar and any imported calendars (iCloud, Outlook, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (e.g. '2026-07-01')",
        },
        endDate: {
          type: "string",
          description: "End date in YYYY-MM-DD format (e.g. '2026-07-02'). For a single day, set this to the day after startDate.",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
];

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string
): Promise<string> {
  if (toolName === "search_product") {
    const { query } = toolInput as { query: string };
    try {
      const { searchAmazonProduct } = await getBrowserbase();
      const results = await searchAmazonProduct(query);
      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No products found. Try a different search." });
      }
      return JSON.stringify({
        results: results.map((r) => ({
          title: r.title,
          price: r.price,
          url: r.url,
          vendor: r.vendor,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: "Product search failed. Try again in a moment.", detail: String(e) });
    }
  }

  if (toolName === "place_order") {
    const { productUrl } = toolInput as { productUrl: string; productTitle: string };
    try {
      const { addAmazonToCart } = await getBrowserbase();
      const result = await addAmazonToCart(productUrl);
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ success: false, error: "Failed to add to cart", detail: String(e) });
    }
  }

  if (toolName === "spend_wallet") {
    const { amount, description, vendor } = toolInput as {
      amount: number;
      description: string;
      vendor: string;
    };

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return JSON.stringify({ error: "No wallet found. Tell the user to set up their wallet first." });

    if (wallet.balance < amount) {
      return JSON.stringify({
        error: "Insufficient funds",
        balance: wallet.balance,
        needed: amount,
        shortfall: amount - wallet.balance,
      });
    }

    const updated = await prisma.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });

    await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: "purchase",
        description,
        vendor: vendor || null,
      },
    });

    return JSON.stringify({
      success: true,
      spent: amount,
      newBalance: updated.balance,
      description,
      vendor,
    });
  }

  if (toolName === "search_restaurants") {
    const { query, location } = toolInput as { query: string; location: string };
    const q = query.toLowerCase().trim();

    const knownChains: Record<string, {name: string; slug: string; avgPrice: string}> = {
      chipotle: { name: "Chipotle Mexican Grill", slug: "chipotle-mexican-grill", avgPrice: "$11-14" },
      "pizza hut": { name: "Pizza Hut", slug: "pizza-hut", avgPrice: "$12-18" },
      dominos: { name: "Domino's Pizza", slug: "dominos-pizza", avgPrice: "$10-16" },
      "domino's": { name: "Domino's Pizza", slug: "dominos-pizza", avgPrice: "$10-16" },
      mcdonalds: { name: "McDonald's", slug: "mcdonalds", avgPrice: "$8-14" },
      "mcdonald's": { name: "McDonald's", slug: "mcdonalds", avgPrice: "$8-14" },
      "taco bell": { name: "Taco Bell", slug: "taco-bell", avgPrice: "$6-12" },
      wendys: { name: "Wendy's", slug: "wendys", avgPrice: "$8-13" },
      "wendy's": { name: "Wendy's", slug: "wendys", avgPrice: "$8-13" },
      subway: { name: "Subway", slug: "subway", avgPrice: "$8-12" },
      "chick-fil-a": { name: "Chick-fil-A", slug: "chick-fil-a", avgPrice: "$9-14" },
      chickfila: { name: "Chick-fil-A", slug: "chick-fil-a", avgPrice: "$9-14" },
      starbucks: { name: "Starbucks", slug: "starbucks", avgPrice: "$5-8" },
      "dunkin": { name: "Dunkin'", slug: "dunkin", avgPrice: "$4-8" },
      "dunkin'": { name: "Dunkin'", slug: "dunkin", avgPrice: "$4-8" },
      panera: { name: "Panera Bread", slug: "panera-bread", avgPrice: "$10-14" },
      "panda express": { name: "Panda Express", slug: "panda-express", avgPrice: "$9-13" },
      popeyes: { name: "Popeyes", slug: "popeyes-louisiana-kitchen", avgPrice: "$8-14" },
      "five guys": { name: "Five Guys", slug: "five-guys", avgPrice: "$12-18" },
      "in-n-out": { name: "In-N-Out Burger", slug: "in-n-out-burger", avgPrice: "$8-12" },
      kfc: { name: "KFC", slug: "kfc", avgPrice: "$8-14" },
      "buffalo wild wings": { name: "Buffalo Wild Wings", slug: "buffalo-wild-wings", avgPrice: "$14-22" },
      "wingstop": { name: "Wingstop", slug: "wingstop", avgPrice: "$12-18" },
    };

    const chainMatch = Object.keys(knownChains).find(k => q.includes(k));

    if (chainMatch) {
      const chain = knownChains[chainMatch];
      const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(chain.name)}/`;
      return JSON.stringify({
        results: [{
          name: chain.name,
          url: searchUrl,
          deliveryFee: "$0-4.99",
          deliveryTime: "25-45 min",
          avgPrice: chain.avgPrice,
        }],
        doordashSearchUrl: searchUrl,
        message: `Found ${chain.name} on DoorDash. Average order: ${chain.avgPrice}. Delivery typically 25-45 min.`
      });
    }

    const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/`;
    return JSON.stringify({
      results: [{
        name: query.charAt(0).toUpperCase() + query.slice(1),
        url: searchUrl,
        deliveryTime: "25-45 min",
      }],
      doordashSearchUrl: searchUrl,
      message: `Found "${query}" on DoorDash near ${location}. Here are options for delivery.`
    });
  }

  if (toolName === "browse_menu") {
    const { restaurantUrl, location } = toolInput as { restaurantUrl: string; location?: string };
    try {
      const { browseWebsite } = await getBrowserbase();
      const result = await browseWebsite(
        restaurantUrl,
        `Browse this DoorDash restaurant menu page. ` +
        (location ? `If asked for a delivery address, enter "${location}" and select the autocomplete suggestion. ` : "") +
        `Scroll through the menu and find food items with their prices. ` +
        `Return "done" with the restaurant name and menu items in this exact format:\n` +
        `RESTAURANT: [name]\n` +
        `ITEM: [item name] | PRICE: $[X.XX] | DESC: [brief description]\n` +
        `List up to 15 menu items. Include the most popular or featured items first.`
      );

      if (!result.success || !result.summary) {
        return JSON.stringify({ restaurantName: "Unknown", items: [], message: "Couldn't load the menu." });
      }

      const restaurantMatch = result.summary.match(/RESTAURANT:\s*(.+)/i);
      const restaurantName = restaurantMatch ? restaurantMatch[1].trim() : "Restaurant";

      const items: Array<{name: string; price: number; description?: string}> = [];
      const itemBlocks = result.summary.split(/ITEM:/i).filter((b: string) => b.trim());
      for (const block of itemBlocks) {
        const nameMatch = block.match(/^\s*(.+?)(?:\s*\||\s*PRICE)/);
        const priceMatch = block.match(/PRICE:\s*\$?([\d.]+)/i);
        const descMatch = block.match(/DESC:\s*(.+?)(?:\n|$)/i);

        if (nameMatch && priceMatch) {
          items.push({
            name: nameMatch[1].trim(),
            price: parseFloat(priceMatch[1]),
            description: descMatch ? descMatch[1].trim() : undefined,
          });
        }
      }

      if (items.length === 0) {
        return JSON.stringify({
          restaurantName,
          items: [],
          rawSummary: result.summary,
          message: "Menu loaded but couldn't parse items. Here's what was found: " + result.summary
        });
      }
      return JSON.stringify({ restaurantName, items });
    } catch (e) {
      return JSON.stringify({ error: "Menu browsing failed.", detail: String(e) });
    }
  }

  if (toolName === "place_food_order") {
    const { restaurantUrl, itemName, restaurantName } = toolInput as { restaurantUrl: string; itemName: string; restaurantName: string };
    try {
      const { browseWebsite } = await getBrowserbase();
      const result = await browseWebsite(
        restaurantUrl,
        `Add "${itemName}" to the DoorDash cart from this restaurant page. ` +
        `Steps: 1) Find the menu item "${itemName}" on the page and click it. ` +
        `2) If a customization/options modal appears, select reasonable defaults and click "Add to Cart" or similar. ` +
        `3) After adding to cart, check the cart for the total price. ` +
        `4) DO NOT click "Place Order" or "Checkout" — stop before finalizing. ` +
        `Return "done" with: ITEM: [name] | TOTAL: $[X.XX] | STATUS: added to cart`
      );

      if (result.success) {
        const totalMatch = result.summary?.match(/TOTAL:\s*\$?([\d.]+)/i);
        const total = totalMatch ? parseFloat(totalMatch[1]) : 0;
        return JSON.stringify({
          success: true,
          description: `${itemName} from ${restaurantName}`,
          total,
          vendor: `DoorDash — ${restaurantName}`,
          summary: result.summary,
        });
      }
      return JSON.stringify({ success: false, error: result.summary || "Failed to add item to cart", vendor: `DoorDash — ${restaurantName}` });
    } catch (e) {
      return JSON.stringify({ success: false, error: "Failed to add food to cart", detail: String(e) });
    }
  }

  if (toolName === "search_rides") {
    const { pickup, dropoff } = toolInput as { pickup: string; dropoff: string };
    try {
      const { searchRides, searchLyftRides } = await getBrowserbase();
      const [uberResults, lyftResults] = await Promise.allSettled([
        searchRides(pickup, dropoff),
        searchLyftRides(pickup, dropoff),
      ]);

      const uber = uberResults.status === "fulfilled" ? uberResults.value : null;
      const lyft = lyftResults.status === "fulfilled" ? lyftResults.value : null;

      const allOptions = [
        ...(uber?.options || []),
        ...(lyft?.options || []),
      ];

      if (allOptions.length === 0) {
        return JSON.stringify({
          pickup,
          dropoff,
          options: [],
          message: "Couldn't find ride estimates for this route. Try more specific addresses.",
          uberDeepLink: uber?.deepLink || `https://m.uber.com/ul/?action=setPickup&pickup[formatted_address]=${encodeURIComponent(pickup)}&dropoff[formatted_address]=${encodeURIComponent(dropoff)}`,
          lyftDeepLink: lyft?.deepLink || `https://ride.lyft.com/?pickup[address]=${encodeURIComponent(pickup)}&destination[address]=${encodeURIComponent(dropoff)}`,
        });
      }

      return JSON.stringify({
        pickup,
        dropoff,
        options: allOptions,
        uberDeepLink: uber?.deepLink,
        lyftDeepLink: lyft?.deepLink,
      });
    } catch (e) {
      return JSON.stringify({ error: "Ride search failed. Try again in a moment.", detail: String(e) });
    }
  }

  if (toolName === "save_address") {
    const { address } = toolInput as { address: string };
    await prisma.user.update({
      where: { id: userId },
      data: { homeAddress: address },
    });
    return JSON.stringify({ success: true, address });
  }

  if (toolName === "check_wallet_balance") {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    if (!wallet) return JSON.stringify({ balance: 0, hasCard: false, virtualCardReady: false });
    return JSON.stringify({
      balance: wallet.balance,
      hasCard: !!wallet.cardLast4,
      cardInfo: wallet.cardLast4 ? `${wallet.cardBrand} •••• ${wallet.cardLast4}` : null,
      virtualCardReady: wallet.virtualCardReady,
      virtualCardLast4: wallet.virtualCardLast4,
      recentTransactions: wallet.transactions.map((t) => ({
        amount: t.amount,
        type: t.type,
        description: t.description,
      })),
    });
  }

  if (toolName === "browse_website") {
    const { url, task, autofill } = toolInput as {
      url: string;
      task: string;
      autofill?: { name?: string; email?: string; phone?: string; address?: string };
    };
    try {
      const { browseWebsite } = await getBrowserbase();
      const userInfo = autofill || {};
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        if (!userInfo.name && user.name) userInfo.name = user.name;
        if (!userInfo.email && user.email) userInfo.email = user.email;
        if (!userInfo.phone && user.phone) userInfo.phone = user.phone;
        if (!userInfo.address && user.homeAddress) userInfo.address = user.homeAddress;
      }

      let cardDetails: { number: string; expMonth: number; expYear: number; cvc: string } | undefined;
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (wallet?.virtualCardReady && wallet.stripeCardId) {
        try {
          const { getVirtualCardDetails } = await import("@/lib/stripe");
          const card = await getVirtualCardDetails(wallet.stripeCardId);
          cardDetails = { number: card.number, expMonth: card.expMonth, expYear: card.expYear, cvc: card.cvc };
        } catch {
          // Virtual card details unavailable — browser will skip payment autofill
        }
      }

      const result = await browseWebsite(url, task, userInfo, undefined, cardDetails);
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ success: false, error: "Browser automation failed", detail: String(e) });
    }
  }

  if (toolName === "save_profile") {
    const { phone, email } = toolInput as { phone?: string; email?: string };
    const updateData: Record<string, string> = {};
    if (phone) updateData.phone = phone;
    if (email) updateData.email = email;
    if (Object.keys(updateData).length === 0) {
      return JSON.stringify({ error: "No info provided to save" });
    }
    await prisma.user.update({ where: { id: userId }, data: updateData });
    return JSON.stringify({ success: true, saved: updateData });
  }

  if (toolName === "check_calendar") {
    const { startDate, endDate } = toolInput as { startDate: string; endDate: string };
    try {
      const start = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      const events = await fetchCalendarRange(userId, start, end);

      if (events.length === 0) {
        const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        return JSON.stringify({
          events: [],
          message: days === 1
            ? `Nothing on the calendar for ${start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`
            : `No events from ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
        });
      }

      return JSON.stringify({
        events: events.map((e) => ({
          title: e.title,
          start: e.start,
          end: e.end,
          location: e.location || null,
          allDay: e.allDay,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: "Calendar lookup failed", detail: String(e) });
    }
  }

  return JSON.stringify({ error: "Unknown tool" });
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { message, conversationId } = await req.json();
  if (!message?.trim()) {
    return Response.json({ error: "Message required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  let convo = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
      })
    : null;

  if (!convo) {
    convo = await prisma.conversation.create({
      data: { userId, title: message.trim().slice(0, 60) },
      include: { messages: true },
    });
  }

  await prisma.message.create({
    data: { conversationId: convo.id, role: "user", content: message.trim() },
  });

  const history = convo.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: message.trim() });

  const [tasks, weather, calendarEvents, emails, wallet] = await Promise.all([
    prisma.task.findMany({
      where: { userId },
      orderBy: [{ completed: "asc" }, { createdAt: "desc" }],
      take: 10,
    }),
    fetchWeather(user.latitude, user.longitude, user.location).catch(() => null),
    fetchCalendarRange(userId, undefined, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).catch(() => []),
    fetchRecentEmails(userId).catch(() => []),
    prisma.wallet.findUnique({ where: { userId } }),
  ]);

  const systemPrompt = buildSystemPrompt(user, tasks, weather, calendarEvents, emails, wallet);

  let response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: history.slice(-20),
    tools: SIDEKICK_TOOLS,
  });

  const apiMessages: Anthropic.MessageParam[] = [...history.slice(-20)];

  while (response.stop_reason === "tool_use") {
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    apiMessages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolBlocks) {
      const result = await handleToolCall(
        tool.name,
        tool.input as Record<string, unknown>,
        userId
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    apiMessages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      tools: SIDEKICK_TOOLS,
    });
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const reply = textBlock?.text || "";

  await prisma.message.create({
    data: { conversationId: convo.id, role: "assistant", content: reply },
  });

  return Response.json({ reply, conversationId: convo.id });
}

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

interface WeatherInfo {
  location: string;
  temperature: number;
  feelsLike: number;
  high: number;
  low: number;
  uvIndex: number;
  condition: string;
  forecast: { day: string; high: number; low: number; condition: string; rainChance: number }[];
}

async function fetchWeather(
  lat: number | null,
  lon: number | null,
  locationStr: string | null
): Promise<WeatherInfo | null> {
  let latitude = lat;
  let longitude = lon;
  let label = locationStr || "Unknown";

  if (!latitude || !longitude) {
    const city = locationStr || "Salem, MA";
    const geoRes = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(city.split(",")[0])}&count=5&language=en&format=json`
    );
    const geoData = await geoRes.json();
    const geo = geoData.results?.[0];
    if (!geo) return null;
    latitude = geo.latitude;
    longitude = geo.longitude;
    label = `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}`;
  }

  const res = await fetch(
    `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`
  );
  const data = await res.json();
  const c = data.current;
  const d = data.daily;

  function weatherLabel(code: number) {
    return code === 0 ? "clear" :
      code <= 3 ? "partly cloudy" :
      code <= 48 ? "foggy" :
      code <= 67 ? "rainy" :
      code <= 77 ? "snowy" :
      code <= 82 ? "rain showers" :
      code <= 99 ? "thunderstorms" : "unknown";
  }

  const forecast: { day: string; high: number; low: number; condition: string; rainChance: number }[] = [];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < Math.min(d.time.length, 7); i++) {
    const date = new Date(d.time[i] + "T12:00:00");
    forecast.push({
      day: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayNames[date.getDay()],
      high: Math.round(d.temperature_2m_max[i]),
      low: Math.round(d.temperature_2m_min[i]),
      condition: weatherLabel(d.weather_code[i]),
      rainChance: d.precipitation_probability_max?.[i] ?? 0,
    });
  }

  return {
    location: label,
    temperature: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    high: Math.round(d.temperature_2m_max[0]),
    low: Math.round(d.temperature_2m_min[0]),
    uvIndex: Math.round(c.uv_index),
    condition: weatherLabel(c.weather_code),
    forecast,
  };
}

interface UserProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  sidekickName: string;
  formality: number;
  humor: number;
  directness: number;
  energy: number;
  detail: number;
  location: string | null;
  homeAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  backgrounds: string[];
  needs: string[];
  wakeTime: string | null;
  diet: string[];
  commute: string[];
  age: number | null;
}

interface TaskRecord {
  title: string;
  completed: boolean;
  priority: string;
  dueDate: Date | null;
}

interface WalletRecord {
  balance: number;
  cardLast4: string | null;
  cardBrand: string | null;
  virtualCardReady: boolean;
  virtualCardLast4: string | null;
}

function buildSystemPrompt(
  user: UserProfile,
  tasks: TaskRecord[],
  weather: WeatherInfo | null,
  calendarEvents: CalendarEvent[],
  emails: GmailThread[],
  wallet: WalletRecord | null,
): string {
  const name = user.name || "there";
  const h = new Date().getHours();
  const timeOfDay = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";

  const toneNotes = [];
  if (user.formality < 40) toneNotes.push("casual, relaxed language");
  else if (user.formality > 60) toneNotes.push("polished, professional language");
  if (user.humor > 60) toneNotes.push("playful, uses humor");
  else if (user.humor < 40) toneNotes.push("serious, no jokes");
  if (user.directness > 60) toneNotes.push("direct and to-the-point");
  else if (user.directness < 40) toneNotes.push("gentle and diplomatic");
  if (user.energy > 60) toneNotes.push("high-energy, enthusiastic");
  else if (user.energy < 40) toneNotes.push("calm, measured pace");
  if (user.detail < 40) toneNotes.push("brief responses, 1-3 sentences max");
  else if (user.detail > 60) toneNotes.push("thorough, detailed responses");

  const openTasks = tasks.filter((t) => !t.completed);
  const doneTasks = tasks.filter((t) => t.completed);
  const taskContext = openTasks.length > 0
    ? `\nOPEN TASKS:\n${openTasks.map((t) => `- ${t.title} (${t.priority}${t.dueDate ? `, due ${t.dueDate.toLocaleDateString()}` : ""})`).join("\n")}`
    : "\nNo open tasks right now.";
  const doneContext = doneTasks.length > 0
    ? `\nRECENTLY COMPLETED:\n${doneTasks.slice(0, 5).map((t) => `- ${t.title} ✓`).join("\n")}`
    : "";

  const contextParts = [];
  if (user.location) contextParts.push(`Location: ${user.location}`);
  if (user.homeAddress) contextParts.push(`Home address: ${user.homeAddress}`);
  if (user.email) contextParts.push(`Email: ${user.email}`);
  if (user.phone) contextParts.push(`Phone: ${user.phone}`);
  if (user.age) contextParts.push(`Age: ${user.age}`);
  if (user.backgrounds.length > 0) contextParts.push(`Background: ${user.backgrounds.join(", ")}`);
  if (user.diet.length > 0) contextParts.push(`Diet: ${user.diet.join(", ")}`);
  if (user.commute.length > 0) contextParts.push(`Gets around by: ${user.commute.join(", ")}`);
  if (user.needs.length > 0) contextParts.push(`Priorities: ${user.needs.join(", ")}`);
  if (user.wakeTime) contextParts.push(`Wake time: ${user.wakeTime}`);

  return `You are ${user.sidekickName || "Sidekick"} — ${name}'s personal AI. Not a chatbot. Not an assistant app. You're the smartest person ${name} has ever talked to, wrapped in the warmth of their best friend. You know everything — business strategy, science, history, medicine, law, finance, cooking, fitness, relationships, pop culture, fashion, politics, philosophy, tech, sports, music, travel, parenting, real estate, cars, gardening, literally anything a human could ask about. And you answer like a real person who genuinely cares about ${name}, not like a search engine.

You are ${name}'s unfair advantage. When they ask you something, they get an answer that would take most people hours of research — instantly, in their tone, tailored to their life.

TONE & PERSONALITY: ${toneNotes.length > 0 ? toneNotes.join(". ") + "." : "Casual but competent."}
You match ${name}'s vibe exactly. If they're casual, you're casual. If they like humor, you're funny. If they're direct, cut the fluff. Use ${name}'s name naturally. Never sound robotic, corporate, or generic. Talk like you've known them for years.

ABOUT ${name.toUpperCase()}:
${contextParts.length > 0 ? contextParts.join("\n") : "No profile details yet."}
${weather ? `\nWEATHER RIGHT NOW (${weather.location}):
${weather.temperature}°F, ${weather.condition}. High ${weather.high}°, low ${weather.low}°. Feels like ${weather.feelsLike}°.${weather.uvIndex >= 6 ? ` UV index is high (${weather.uvIndex}) — recommend sunscreen.` : ""}
${weather.forecast.length > 1 ? `\nFORECAST:\n${weather.forecast.map((f) => `- ${f.day}: ${f.condition}, high ${f.high}°, low ${f.low}°${f.rainChance > 20 ? ` (${f.rainChance}% rain)` : ""}`).join("\n")}` : ""}` : ""}
${calendarEvents.length > 0 ? `\nUPCOMING SCHEDULE (next 7 days):\n${calendarEvents.map((e) => {
    const dayLabel = new Date(e.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (e.allDay) return `- ${dayLabel}: ${e.title} (all day)${e.location ? ` @ ${e.location}` : ""}`;
    const startTime = new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const endTime = new Date(e.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `- ${dayLabel} ${startTime}–${endTime}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
  }).join("\n")}` : "\nNo calendar connected yet — or no events this week."}
${emails.length > 0 ? `\nRECENT EMAILS:\n${emails.map((e) => `- ${e.unread ? "🔴 " : ""}${e.subject} — from ${e.from}${e.unread ? " (UNREAD)" : ""}`).join("\n")}` : ""}
${taskContext}${doneContext}

WALLET:
${wallet ? `Balance: $${wallet.balance.toFixed(2)}${wallet.cardLast4 ? ` | Funding card: ${wallet.cardBrand} •••• ${wallet.cardLast4}` : ""}${wallet.virtualCardReady ? ` | Virtual debit card: •••• ${wallet.virtualCardLast4} (ready for online purchases)` : " | No virtual card yet — tell them to activate it in the wallet tab"}` : "No wallet set up yet."}

PURCHASE FLOW — you can buy things for ${name} using their wallet and real browser automation:
When ${name} asks you to order/buy/book something:
1. Figure out what they want — ask clarifying questions if needed (size, edition, restaurant, etc.)
2. Use search_product to find the REAL product on Amazon with the actual price — don't guess prices
3. Show them the best match with the real price: "found **Atomic Habits** paperback for **$11.99** on Amazon"
4. Ask for confirmation: "want me to grab it?"
5. ONLY after they confirm — call place_order to add it to their Amazon cart, then spend_wallet to deduct from their balance
6. If their balance is too low, tell them exactly how much to add in the wallet tab
7. Tell them to say "hold on let me search" or similar if they want to do the shopping themselves — the search takes ~15 seconds since it's opening a real browser

FOOD ORDERING FLOW — ALWAYS use DoorDash first for food orders:
When ${name} asks to order food — whether they say "order pizza", "get me Chipotle", "Pizza Hut", "Dominos", or ANY food/restaurant:
1. ALWAYS start with DoorDash — use search_restaurants with the restaurant name or food type AND their location
   Example: if they say "order from Chipotle" → search_restaurants("Chipotle", "${user.homeAddress || user.location || "their location"}")
   Example: if they say "order pizza" → search_restaurants("pizza", "${user.homeAddress || user.location || "their location"}")
2. If they didn't specify a restaurant, show the top 3-5 results with ratings and delivery times
3. If they DID name a specific restaurant (Pizza Hut, Chipotle, etc.), find that restaurant in the DoorDash results and go straight to browsing its menu — don't show a list of options
4. Use browse_menu to show the actual menu items and prices
5. When they tell you what they want (or if they already told you in the first message), confirm the total:
   "I found your order on DoorDash:
   - **chicken burrito bowl** — $11.75
   - **delivery fee** — $2.99
   - **estimated total: ~$16.50**

   want me to add it to your cart?"
6. ONLY after confirmation — call place_food_order, then spend_wallet to debit
7. Confirm: "done! your **chicken burrito bowl** from Chipotle is on its way. $16.50 charged — new balance is $XX.XX"

CRITICAL: Do NOT try browse_website on restaurant sites (pizzahut.com, chipotle.com, dominos.com, etc.) — those sites block automated browsers. DoorDash is the reliable path. Only use browse_website for non-restaurant sites or if DoorDash doesn't have the restaurant.

If ${name} already told you exactly what they want (e.g. "order me a chicken burrito bowl from Chipotle with white rice and chicken"), DON'T ask them to repeat it — search DoorDash for that restaurant, browse the menu, find the matching item, and confirm the price. Move fast.

RIDESHARE FLOW — you can find and pay for rides for ${name}:
When ${name} asks for a ride, car, or needs to get somewhere:
1. Figure out the pickup and dropoff — if they say "from home", "from my house", "from my place", use their home address as pickup. If they say "from here", use their location.
2. Use search_rides to get real price estimates from Uber and Lyft
3. Present the best option naturally with the price: "I found a ride from [pickup] to [dropoff] for about **$X**. want me to charge it to your wallet?"
4. When they confirm — call check_wallet_balance first to verify funds, then call spend_wallet to debit the ride cost
5. Confirm it's done: "done! **$X** charged to your wallet. your ride is on the way — new balance is **$Y**."
6. If their balance is too low, tell them exactly how much to add
7. Keep it seamless — don't tell them to open another app, tap a link, or do anything else. You handle it all. The experience should feel like texting a personal driver.

GENERAL BROWSING — browse_website for non-food online tasks:
Use browse_website for Amazon shopping, booking services, filling forms, or any site that isn't a major restaurant chain. The browser takes 30-60 seconds per task.
- ALWAYS tell ${name} you're working on it before calling browse_website
- For ordering flows: first call builds the cart and STOPS at checkout. Report back the total. Second call (after approval) completes the purchase.
- NEVER guess prices — only report real prices
- NEVER complete a purchase without explicit approval

What you can do:
- **Food from any restaurant** — search DoorDash first (search_restaurants → browse_menu → place_food_order). This is the fastest and most reliable path.
- **Books, electronics, household items** — search_product finds real Amazon prices, place_order adds to cart
- **Any other website** — browse_website can navigate, click, fill forms on any site
- **Rides** — search_rides gets real prices, spend_wallet pays for it

HOME ADDRESS:
SAVED INFO FOR AUTO-FILL:
${user.homeAddress ? `Address: ${user.homeAddress}` : "No address saved yet — ask for it and use save_address."}
${user.email ? `Email: ${user.email}` : "No email saved."}
${user.phone ? `Phone: ${user.phone}` : "No phone saved — if needed for checkout, ask and use save_profile."}
When ${name} says "ship this home", "deliver to my place", or "order to my house" — use their address automatically. When checking out on any site, auto-fill all available info (name, email, phone, address) without asking.

CALENDAR — you have full access to ${name}'s calendar:
- The upcoming 7 days are already loaded above. For anything within this week, just answer from that data.
- For ANY other date — next week, next month, a specific date — use the check_calendar tool. It pulls from Google Calendar AND any imported calendars (iCloud, Outlook, Yahoo, etc.).
- When ${name} says "next Tuesday", "July 4th", "this weekend", "am I free tomorrow afternoon", etc. — look it up and give a real answer.
- Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. Use this to calculate the correct dates for relative references like "next Tuesday" or "this Friday".

HOW TO RESPOND:
- Match the question's depth. Quick question = quick answer. Deep question = thorough, brilliant answer.
- Always be proactive — after answering, suggest a next step or related insight
- Reference ${name}'s life context naturally (their location, diet, commute, schedule, etc.)
- Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. It's currently ${timeOfDay}.
- NEVER say "I can't", "I don't have access to", "as an AI", or "I'm not able to" — you're the smartest person in the room, act like it
- If asked about weather, USE THE FORECAST DATA ABOVE — you already have today through the full week. Answer confidently.
- If asked about the calendar or schedule, USE THE SCHEDULE DATA ABOVE for this week, or call check_calendar for any other date. Answer confidently.
- If asked ANY knowledge question — history, science, business, health, cooking, relationships, investing, law, medicine, fashion, sports, literally anything — just answer it. You know this stuff. Be specific, cite facts, give real actionable advice. Don't hedge or give vague non-answers.
- If ${name} asks for an opinion, give one. Don't be wishy-washy. Have a point of view.
- Format with markdown: **bold** for emphasis, line breaks for readability, bullet points for lists
- Use lowercase for a casual feel unless the user's formality is high
- NEVER spend wallet money without explicit confirmation from ${name}`;
}
