import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { fetchTodayEvents, fetchRecentEmails, CalendarEvent, GmailThread } from "@/lib/google";
import { searchAmazonProduct, addAmazonToCart, searchDoorDashRestaurants, browseDoorDashMenu, addDoorDashToCart, searchRides, searchLyftRides } from "@/lib/browserbase";

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
];

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string
): Promise<string> {
  if (toolName === "search_product") {
    const { query } = toolInput as { query: string };
    try {
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
    const { productUrl, productTitle } = toolInput as { productUrl: string; productTitle: string };
    try {
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
    try {
      const results = await searchDoorDashRestaurants(query, location);
      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No restaurants found. Try a different search or cuisine." });
      }
      return JSON.stringify({ results });
    } catch (e) {
      return JSON.stringify({ error: "Restaurant search failed. Try again in a moment.", detail: String(e) });
    }
  }

  if (toolName === "browse_menu") {
    const { restaurantUrl, location } = toolInput as { restaurantUrl: string; location?: string };
    try {
      const menu = await browseDoorDashMenu(restaurantUrl, location);
      if (menu.items.length === 0) {
        return JSON.stringify({ restaurantName: menu.restaurantName, items: [], message: "Couldn't load the menu. The restaurant might require a login or the page layout changed." });
      }
      return JSON.stringify(menu);
    } catch (e) {
      return JSON.stringify({ error: "Menu browsing failed.", detail: String(e) });
    }
  }

  if (toolName === "place_food_order") {
    const { restaurantUrl, itemName, restaurantName } = toolInput as { restaurantUrl: string; itemName: string; restaurantName: string };
    try {
      const result = await addDoorDashToCart(restaurantUrl, itemName);
      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ success: false, error: "Failed to add food to cart", detail: String(e) });
    }
  }

  if (toolName === "search_rides") {
    const { pickup, dropoff } = toolInput as { pickup: string; dropoff: string };
    try {
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
    if (!wallet) return JSON.stringify({ balance: 0, hasCard: false });
    return JSON.stringify({
      balance: wallet.balance,
      hasCard: !!wallet.cardLast4,
      cardInfo: wallet.cardLast4 ? `${wallet.cardBrand} •••• ${wallet.cardLast4}` : null,
      recentTransactions: wallet.transactions.map((t) => ({
        amount: t.amount,
        type: t.type,
        description: t.description,
      })),
    });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

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
    fetchTodayEvents(userId).catch(() => []),
    fetchRecentEmails(userId).catch(() => []),
    prisma.wallet.findUnique({ where: { userId } }),
  ]);

  const systemPrompt = buildSystemPrompt(user, tasks, weather, calendarEvents, emails, wallet);

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
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
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
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
    `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
  );
  const data = await res.json();
  const c = data.current;
  const d = data.daily;

  const code = c.weather_code;
  const condition =
    code === 0 ? "clear" :
    code <= 3 ? "partly cloudy" :
    code <= 48 ? "foggy" :
    code <= 67 ? "rainy" :
    code <= 77 ? "snowy" :
    code <= 82 ? "rain showers" :
    code <= 99 ? "thunderstorms" : "unknown";

  return {
    location: label,
    temperature: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    high: Math.round(d.temperature_2m_max[0]),
    low: Math.round(d.temperature_2m_min[0]),
    uvIndex: Math.round(c.uv_index),
    condition,
  };
}

interface UserProfile {
  name: string | null;
  sidekickName: string;
  formality: number;
  humor: number;
  directness: number;
  energy: number;
  detail: number;
  location: string | null;
  homeAddress: string | null;
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
  if (user.age) contextParts.push(`Age: ${user.age}`);
  if (user.backgrounds.length > 0) contextParts.push(`Background: ${user.backgrounds.join(", ")}`);
  if (user.diet.length > 0) contextParts.push(`Diet: ${user.diet.join(", ")}`);
  if (user.commute.length > 0) contextParts.push(`Gets around by: ${user.commute.join(", ")}`);
  if (user.needs.length > 0) contextParts.push(`Priorities: ${user.needs.join(", ")}`);
  if (user.wakeTime) contextParts.push(`Wake time: ${user.wakeTime}`);

  return `You are ${user.sidekickName || "Sidekick"}, a personal AI assistant for ${name}. You're proactive, warm, and action-oriented — like a real human chief of staff who knows everything about their life.

PERSONALITY: ${toneNotes.length > 0 ? toneNotes.join(". ") + "." : "Casual but competent."} You talk like a trusted friend who happens to be incredibly organized. Never robotic. Use ${name}'s name naturally. No corporate speak.

ABOUT ${name.toUpperCase()}:
${contextParts.length > 0 ? contextParts.join("\n") : "No profile details yet."}
${weather ? `\nWEATHER RIGHT NOW (${weather.location}):
${weather.temperature}°F, ${weather.condition}. High ${weather.high}°, low ${weather.low}°. Feels like ${weather.feelsLike}°.${weather.uvIndex >= 6 ? ` UV index is high (${weather.uvIndex}) — recommend sunscreen.` : ""}` : ""}
${calendarEvents.length > 0 ? `\nTODAY'S SCHEDULE:\n${calendarEvents.map((e) => {
    if (e.allDay) return `- ${e.title} (all day)${e.location ? ` @ ${e.location}` : ""}`;
    const startTime = new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const endTime = new Date(e.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `- ${startTime}–${endTime}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
  }).join("\n")}` : "\nNo calendar connected yet — or no events today."}
${emails.length > 0 ? `\nRECENT EMAILS:\n${emails.map((e) => `- ${e.unread ? "🔴 " : ""}${e.subject} — from ${e.from}${e.unread ? " (UNREAD)" : ""}`).join("\n")}` : ""}
${taskContext}${doneContext}

WALLET:
${wallet ? `Balance: $${wallet.balance.toFixed(2)}${wallet.cardLast4 ? ` | Card: ${wallet.cardBrand} •••• ${wallet.cardLast4}` : ""}` : "No wallet set up yet."}

PURCHASE FLOW — you can buy things for ${name} using their wallet and real browser automation:
When ${name} asks you to order/buy/book something:
1. Figure out what they want — ask clarifying questions if needed (size, edition, restaurant, etc.)
2. Use search_product to find the REAL product on Amazon with the actual price — don't guess prices
3. Show them the best match with the real price: "found **Atomic Habits** paperback for **$11.99** on Amazon"
4. Ask for confirmation: "want me to grab it?"
5. ONLY after they confirm — call place_order to add it to their Amazon cart, then spend_wallet to deduct from their balance
6. If their balance is too low, tell them exactly how much to add in the wallet tab
7. Tell them to say "hold on let me search" or similar if they want to do the shopping themselves — the search takes ~15 seconds since it's opening a real browser

FOOD ORDERING FLOW — you can order food for ${name} from DoorDash:
When ${name} asks to order food:
1. Ask what they're in the mood for if they didn't say (use their diet preferences and location as context)
2. Use search_restaurants to find real restaurants near their location on DoorDash
3. Show the top 3-5 results with ratings and delivery times: "found **Sal's Pizza** (4.7★, 25-35 min, $2.99 delivery)"
4. When they pick a restaurant, use browse_menu to show the actual menu items and prices
5. When they pick items, confirm the total: "**large pepperoni** for **$16.99** from Sal's — want me to add it to your cart?"
6. ONLY after confirmation — call place_food_order, then spend_wallet to debit
7. Tell them to head to DoorDash to complete checkout

RIDESHARE FLOW — you can find and pay for rides for ${name}:
When ${name} asks for a ride, car, or needs to get somewhere:
1. Figure out the pickup and dropoff — if they say "from home", "from my house", "from my place", use their home address as pickup. If they say "from here", use their location.
2. Use search_rides to get real price estimates from Uber and Lyft
3. Present the best option naturally with the price: "I found a ride from [pickup] to [dropoff] for about **$X**. want me to charge it to your wallet?"
4. When they confirm — call check_wallet_balance first to verify funds, then call spend_wallet to debit the ride cost
5. Confirm it's done: "done! **$X** charged to your wallet. your ride is on the way — new balance is **$Y**."
6. If their balance is too low, tell them exactly how much to add
7. Keep it seamless — don't tell them to open another app, tap a link, or do anything else. You handle it all. The experience should feel like texting a personal driver.

What you can do:
- **Books, electronics, household items, anything on Amazon** — search_product finds real prices, place_order adds to cart
- **Food from DoorDash** — search_restaurants finds nearby spots, browse_menu shows real menus, place_food_order adds to cart
- **Rides** — search_rides gets real prices, spend_wallet pays for it — fully handled, no other apps needed

HOME ADDRESS:
${user.homeAddress ? `${name}'s home address is **${user.homeAddress}**. When they say "ship this home" or "deliver to my place" or "send it to my house", use this address automatically — no need to ask.` : `${name} hasn't saved a home address yet. If they mention shipping something home or you need a delivery address, ask for their address and use save_address to save it so you remember next time.`}

RULES:
- Always be proactive — suggest the next step
- Keep responses SHORT — 2-4 sentences unless showing a list
- Reference ${name}'s life context naturally (location, diet, commute preferences)
- It's currently ${timeOfDay}
- Don't say "I can't" or "as an AI" — you ARE their assistant
- Format with markdown: **bold**, line breaks, etc.
- Use lowercase for a casual feel unless the user's formality is high
- NEVER spend wallet money without explicit confirmation from ${name}`;
}
