import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { fetchTodayEvents, fetchCalendarRange, fetchRecentEmails, createCalendarEvent, CalendarEvent, GmailThread } from "@/lib/google";
async function getBrowserbase() {
  return await import("@/lib/browserbase");
}

const anthropic = new Anthropic();

const SIDEKICK_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_product",
    description:
      "Search Amazon for a product. Returns real product titles, prices, and URLs. Use this when the user asks to buy, order, or find a NON-FOOD item — books, electronics, household items, clothes, gifts, etc. If the request is about food delivery, use search_restaurants instead.",
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
      "Search DoorDash for restaurants near the user's location. Returns restaurant names, ratings, delivery times, and URLs. Use ONLY when the user wants to order FOOD for delivery — meals, drinks, groceries from restaurants. Do NOT use for books, electronics, or non-food items (use search_product for those).",
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
  {
    name: "add_calendar_event",
    description:
      "Add an event to the user's Google Calendar. Use when the user asks to add, schedule, or put something on their calendar. Convert relative dates to absolute (tomorrow, this Friday, etc.). Default duration is 1 hour if not specified.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Event title (e.g. 'Dinner at Ledger', 'Team meeting', 'Dentist appointment')",
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        startTime: {
          type: "string",
          description: "Start time in HH:MM 24-hour format (e.g. '19:00' for 7 PM)",
        },
        endTime: {
          type: "string",
          description: "End time in HH:MM 24-hour format. Defaults to 1 hour after start if not specified.",
        },
        location: {
          type: "string",
          description: "Optional location/address for the event",
        },
        description: {
          type: "string",
          description: "Optional description or notes for the event",
        },
      },
      required: ["title", "date", "startTime"],
    },
  },
  {
    name: "make_reservation",
    description:
      "Step 1 of 2: Look up a restaurant and prepare reservation data. Returns restaurant info and an internal reservationUrl. IMPORTANT: The reservationUrl is for complete_reservation only — NEVER show it to the user as a link. After this returns, ask the user about seating preference, then call complete_reservation (step 2) to actually book.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant: {
          type: "string",
          description: "Restaurant name (e.g. 'Ledger', 'Turner\\'s Seafood', 'Bambolina')",
        },
        date: {
          type: "string",
          description: "Reservation date in YYYY-MM-DD format (e.g. '2026-06-25')",
        },
        time: {
          type: "string",
          description: "Reservation time in HH:MM 24-hour format (e.g. '19:00' for 7pm)",
        },
        partySize: {
          type: "number",
          description: "Number of guests (e.g. 2)",
        },
      },
      required: ["restaurant", "date", "time", "partySize"],
    },
  },
  {
    name: "complete_reservation",
    description:
      "Actually complete a restaurant reservation using browser automation. Opens OpenTable/Resy in a real browser, selects the time slot, fills in the user's info, and confirms the booking. Call this AFTER make_reservation and AFTER the user confirms details (seating preference, etc.). Takes 30-60 seconds.",
    input_schema: {
      type: "object" as const,
      properties: {
        reservationUrl: {
          type: "string",
          description: "The OpenTable or Resy URL from make_reservation results",
        },
        restaurantName: {
          type: "string",
          description: "Restaurant name for confirmation",
        },
        date: {
          type: "string",
          description: "Reservation date (e.g. 'Thursday, June 25')",
        },
        time: {
          type: "string",
          description: "Desired time (e.g. '7:00 PM')",
        },
        partySize: {
          type: "number",
          description: "Number of guests",
        },
        seatingPreference: {
          type: "string",
          description: "Seating preference if any (e.g. 'indoor', 'outdoor', 'bar', 'patio'). Leave empty if not specified.",
        },
      },
      required: ["reservationUrl", "restaurantName", "time", "partySize"],
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

    const knownChains: Record<string, {name: string; slug: string; menu: string; deliveryFee: string}> = {
      chipotle: { name: "Chipotle Mexican Grill", slug: "chipotle-mexican-grill", deliveryFee: "$2.99",
        menu: "Burrito Bowl $11.75, Burrito $11.75, Tacos (3) $11.50, Quesadilla $12.95, Salad $11.75, Chips & Guac $4.25, Chips & Queso $5.90, Side of Guac $3.25, Large Chips & Guac $6.50, Kids Quesadilla $6.25. Proteins: Chicken, Steak (+$1.50), Barbacoa (+$1.50), Carnitas, Sofritas, Veggie. Add guac +$3.25, extra protein +$4.00, queso +$1.65" },
      "pizza hut": { name: "Pizza Hut", slug: "pizza-hut", deliveryFee: "$3.99",
        menu: "Large Original Pan Pizza $15.99, Medium Pan Pizza $13.49, Large Hand-Tossed $14.99, Large Thin N Crispy $14.99, Personal Pan $6.99, Breadsticks $5.99, Wings (8pc) $10.99, Garlic Knots $5.99, Cinnabon Mini Rolls $5.49. Toppings: Pepperoni, Sausage, Mushrooms, Onions, Green Peppers, Extra Cheese +$2.00 each" },
      dominos: { name: "Domino's Pizza", slug: "dominos-pizza", deliveryFee: "$4.99",
        menu: "Large Hand Tossed Pizza $13.99, Medium Hand Tossed $11.99, Large Brooklyn Style $14.99, Boneless Wings (8pc) $9.99, Breadsticks $5.99, Cinnamon Twists $5.99, Chicken Alfredo Pasta $9.99, Philly Cheese Steak Sandwich $8.99. Toppings: Pepperoni, Sausage, Mushrooms, Onions +$1.75 each" },
      "domino's": { name: "Domino's Pizza", slug: "dominos-pizza", deliveryFee: "$4.99",
        menu: "Large Hand Tossed Pizza $13.99, Medium Hand Tossed $11.99, Large Brooklyn Style $14.99, Boneless Wings (8pc) $9.99, Breadsticks $5.99" },
      mcdonalds: { name: "McDonald's", slug: "mcdonalds", deliveryFee: "$2.99",
        menu: "Big Mac $6.99, Quarter Pounder with Cheese $7.49, McChicken $3.29, 10pc Chicken McNuggets $6.49, 20pc McNuggets $10.99, Large Fries $4.59, McFlurry $4.89, Egg McMuffin $5.29, Sausage McMuffin $3.99, Filet-O-Fish $5.99" },
      "mcdonald's": { name: "McDonald's", slug: "mcdonalds", deliveryFee: "$2.99",
        menu: "Big Mac $6.99, Quarter Pounder with Cheese $7.49, 10pc McNuggets $6.49, Large Fries $4.59" },
      "taco bell": { name: "Taco Bell", slug: "taco-bell", deliveryFee: "$2.99",
        menu: "Crunchy Taco $2.19, Burrito Supreme $5.49, Crunchwrap Supreme $5.99, Chalupa Supreme $4.99, Nachos BellGrande $6.49, Quesadilla $5.49, Mexican Pizza $5.49, Beefy 5-Layer Burrito $3.99, Cheesy Gordita Crunch $5.49, Cinnamon Twists $1.99" },
      wendys: { name: "Wendy's", slug: "wendys", deliveryFee: "$3.49",
        menu: "Dave's Single $6.99, Dave's Double $8.49, Baconator $9.99, Spicy Chicken Sandwich $7.29, Classic Chicken Sandwich $6.29, 10pc Nuggets $6.49, Large Fries $4.29, Frosty $3.49, Jr. Bacon Cheeseburger $3.49" },
      "wendy's": { name: "Wendy's", slug: "wendys", deliveryFee: "$3.49",
        menu: "Dave's Single $6.99, Dave's Double $8.49, Baconator $9.99, Spicy Chicken Sandwich $7.29" },
      subway: { name: "Subway", slug: "subway", deliveryFee: "$2.99",
        menu: "6-inch Sub $7.49, Footlong Sub $10.99, Italian B.M.T. Footlong $11.49, Turkey Breast Footlong $10.49, Steak & Cheese Footlong $12.49, Meatball Marinara Footlong $9.99, Cookies (3) $2.49" },
      "chick-fil-a": { name: "Chick-fil-A", slug: "chick-fil-a", deliveryFee: "$2.99",
        menu: "Original Chicken Sandwich $6.29, Spicy Chicken Sandwich $6.69, Spicy Deluxe Sandwich $7.69, 8ct Nuggets $6.19, 12ct Nuggets $8.29, Waffle Fries $3.15, Chicken Biscuit $4.75, Mac & Cheese $4.39, Milkshake $5.19" },
      chickfila: { name: "Chick-fil-A", slug: "chick-fil-a", deliveryFee: "$2.99",
        menu: "Original Chicken Sandwich $6.29, Spicy Chicken Sandwich $6.69, 8ct Nuggets $6.19, Waffle Fries $3.15" },
      starbucks: { name: "Starbucks", slug: "starbucks", deliveryFee: "$2.49",
        menu: "Caffe Latte $5.75, Caramel Macchiato $6.25, Iced Coffee $4.45, Cold Brew $4.95, Mocha Frappuccino $5.95, Pink Drink $5.95, Cake Pop $3.75, Bacon Gouda Sandwich $5.75" },
      panera: { name: "Panera Bread", slug: "panera-bread", deliveryFee: "$3.99",
        menu: "Broccoli Cheddar Soup (bowl) $8.39, Mac & Cheese $10.69, Caesar Salad $10.49, Greek Salad $10.99, Frontega Chicken Panini $11.99, Bacon Turkey Bravo $11.49, You Pick Two $11.99" },
      "panda express": { name: "Panda Express", slug: "panda-express", deliveryFee: "$2.99",
        menu: "Plate (2 entrees + 1 side) $10.90, Bigger Plate (3 entrees + 1 side) $13.40, Bowl (1 entree + 1 side) $8.90, Orange Chicken entree $6.40, Beijing Beef $6.40, Kung Pao Chicken $6.40, Fried Rice side $4.90, Chow Mein side $4.90" },
      popeyes: { name: "Popeyes", slug: "popeyes-louisiana-kitchen", deliveryFee: "$3.49",
        menu: "Chicken Sandwich $6.99, Spicy Chicken Sandwich $6.99, 3pc Tenders $7.49, 2pc Chicken Dinner $8.99, 5pc Tenders Combo $11.99, Cajun Fries $3.49, Biscuit $1.79, Red Beans & Rice $3.99" },
      "five guys": { name: "Five Guys", slug: "five-guys", deliveryFee: "$3.99",
        menu: "Cheeseburger $12.69, Little Cheeseburger $10.49, Bacon Cheeseburger $14.19, Hot Dog $7.99, Regular Fries $6.79, Large Fries $9.49, Grilled Cheese $8.29, Milkshake $7.49" },
      kfc: { name: "KFC", slug: "kfc", deliveryFee: "$3.49",
        menu: "Original Recipe Chicken (2pc) $7.49, Extra Crispy (2pc) $7.49, 3pc Tenders $6.99, Famous Bowl $7.99, Chicken Sandwich $6.99, 8pc Bucket $22.99, Mac & Cheese $3.99, Coleslaw $3.49, Biscuit $1.49" },
      wingstop: { name: "Wingstop", slug: "wingstop", deliveryFee: "$3.99",
        menu: "10pc Classic Wings $15.99, 10pc Boneless Wings $14.49, 6pc Classic Wings $10.99, 6pc Boneless Wings $9.99, 4pc Chicken Tenders $9.49, Large Fries $4.79, Cajun Fried Corn $4.79" },
    };

    const chainMatch = Object.keys(knownChains).find(k => q.includes(k));

    if (chainMatch) {
      const chain = knownChains[chainMatch];
      const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(chain.name)}/`;
      return JSON.stringify({
        results: [{
          name: chain.name,
          url: searchUrl,
          deliveryFee: chain.deliveryFee,
          deliveryTime: "25-40 min",
          menu: chain.menu,
        }],
        doordashSearchUrl: searchUrl,
      });
    }

    const searchUrl = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/`;
    return JSON.stringify({
      results: [{
        name: query.charAt(0).toUpperCase() + query.slice(1),
        url: searchUrl,
        deliveryFee: "$2.99-4.99",
        deliveryTime: "25-45 min",
      }],
      doordashSearchUrl: searchUrl,
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

  if (toolName === "make_reservation") {
    const { restaurant, date, time, partySize } = toolInput as {
      restaurant: string;
      date: string;
      time: string;
      partySize: number;
    };
    const q = restaurant.toLowerCase().trim();

    const salemRestaurants: Record<string, {
      name: string;
      platform: "opentable" | "resy" | "direct";
      slug: string;
      cuisine: string;
      priceRange: string;
      address: string;
      directUrl?: string;
    }> = {
      ledger: { name: "Ledger Restaurant & Bar", platform: "opentable", slug: "ledger-restaurant-and-bar-salem", cuisine: "New American", priceRange: "$$$", address: "125 Washington St, Salem, MA" },
      bambolina: { name: "Bambolina", platform: "opentable", slug: "bambolina-salem", cuisine: "Italian, Wood-Fired Pizza", priceRange: "$$", address: "288 Derby St, Salem, MA" },
      settler: { name: "Settler", platform: "resy", slug: "settler", cuisine: "New American, Cocktail Bar", priceRange: "$$$", address: "3 Lynde St, Salem, MA" },
      bernadette: { name: "Bernadette", platform: "resy", slug: "bernadette", cuisine: "French Bistro", priceRange: "$$$", address: "264 Essex St, Salem, MA" },
      adriatic: { name: "Adriatic Restaurant & Bar", platform: "opentable", slug: "adriatic-restaurant-and-bar-salem", cuisine: "Mediterranean, European", priceRange: "$$$", address: "155 Washington St, Salem, MA" },
      "turner's seafood": { name: "Turner's Seafood", platform: "opentable", slug: "turners-seafood-at-lyceum-hall-salem", cuisine: "Seafood", priceRange: "$$$", address: "43 Church St, Salem, MA" },
      turners: { name: "Turner's Seafood", platform: "opentable", slug: "turners-seafood-at-lyceum-hall-salem", cuisine: "Seafood", priceRange: "$$$", address: "43 Church St, Salem, MA" },
      "sea level": { name: "Sea Level Oyster Bar", platform: "opentable", slug: "sea-level-oyster-bar-salem", cuisine: "Seafood, Raw Bar", priceRange: "$$$", address: "94 Wharf St, Salem, MA" },
      "sea level oyster bar": { name: "Sea Level Oyster Bar", platform: "opentable", slug: "sea-level-oyster-bar-salem", cuisine: "Seafood, Raw Bar", priceRange: "$$$", address: "94 Wharf St, Salem, MA" },
      finz: { name: "Finz Seafood & Grill", platform: "opentable", slug: "finz-seafood-and-grill-salem", cuisine: "Seafood", priceRange: "$$$", address: "76 Wharf St, Salem, MA" },
      "mercy tavern": { name: "Mercy Tavern", platform: "opentable", slug: "mercy-tavern-salem", cuisine: "American, Pub", priceRange: "$$", address: "148 Derby St, Salem, MA" },
      "life alive": { name: "Life Alive", platform: "direct", slug: "life-alive-salem", cuisine: "Organic, Plant-Based", priceRange: "$$", address: "261 Essex St, Salem, MA", directUrl: "https://www.lifealive.com/salem" },
      "howling wolf": { name: "Howling Wolf Taqueria", platform: "direct", slug: "howling-wolf", cuisine: "Mexican", priceRange: "$", address: "76 Lafayette St, Salem, MA", directUrl: "https://www.howlingwolftaqueria.com" },
      "flying saucer": { name: "Flying Saucer Pizza", platform: "direct", slug: "flying-saucer", cuisine: "Pizza", priceRange: "$", address: "118 Washington St, Salem, MA", directUrl: "https://www.flyingsaucerpizza.com" },
      "bit bar": { name: "Bit Bar", platform: "direct", slug: "bit-bar", cuisine: "American, Arcade Bar", priceRange: "$$", address: "50 St. Peter St, Salem, MA", directUrl: "https://www.bitbarsalem.com" },
      "notch brewing": { name: "Notch Brewing", platform: "direct", slug: "notch-brewing", cuisine: "Brewery, Beer Garden", priceRange: "$$", address: "283 Derby St, Salem, MA", directUrl: "https://www.notchbrewing.com" },
    };

    const match = Object.keys(salemRestaurants).find(k => q.includes(k));

    if (match) {
      const r = salemRestaurants[match];
      let reservationUrl: string;
      let platform = r.platform;

      if (r.platform === "resy") {
        reservationUrl = `https://resy.com/cities/salem-ma/venues/${r.slug}?date=${date}&seats=${partySize}`;
      } else if (r.platform === "opentable") {
        reservationUrl = `https://www.opentable.com/r/${r.slug}?covers=${partySize}&dateTime=${date}T${time}`;
      } else {
        reservationUrl = r.directUrl || `https://www.google.com/search?q=${encodeURIComponent(r.name + " Salem MA reservations")}`;
      }

      const timeFormatted = new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const dateFormatted = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

      return JSON.stringify({
        found: true,
        restaurant: r.name,
        cuisine: r.cuisine,
        priceRange: r.priceRange,
        address: r.address,
        platform,
        date: dateFormatted,
        time: timeFormatted,
        partySize,
        reservationUrl,
        _nextStep: "Ask user about seating preference (inside/outside/bar/no preference), then call complete_reservation with the reservationUrl above. Do NOT show the reservationUrl to the user as a link.",
      });
    }

    // Restaurant not in local database — use OpenTable API search (works for any restaurant worldwide)
    const reservationUrl = `https://www.opentable.com/r/unknown?covers=${partySize}&dateTime=${date}T${time}`;
    const timeFormatted = new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const dateFormatted = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    return JSON.stringify({
      found: true,
      restaurant,
      platform: "opentable",
      date: dateFormatted,
      time: timeFormatted,
      partySize,
      reservationUrl,
      _nextStep: "Ask user about seating preference (inside/outside/bar/no preference), then call complete_reservation with the reservationUrl above. Do NOT show the reservationUrl to the user as a link.",
    });
  }

  if (toolName === "complete_reservation") {
    const { reservationUrl, restaurantName, time, partySize, seatingPreference } = toolInput as {
      reservationUrl: string;
      restaurantName: string;
      date?: string;
      time: string;
      partySize: number;
      seatingPreference?: string;
    };
    try {
      console.error("[RESERVATION:1] complete_reservation called", JSON.stringify({ restaurantName, reservationUrl, time, partySize, seatingPreference }));
      const { browseWebsite } = await getBrowserbase();
      console.error("[RESERVATION:2] browserbase module imported");
      const user = await prisma.user.findUnique({ where: { id: userId } });
      console.error("[RESERVATION:3] user loaded", JSON.stringify({ name: user?.name, email: user?.email, phone: user?.phone ? "yes" : "no" }));
      const firstName = user?.name?.split(" ")[0] || "Guest";
      const lastName = user?.name?.split(" ").slice(1).join(" ") || "";
      const email = user?.email || "";
      const phone = user?.phone || "";

      let cardDetails: { number: string; expMonth: number; expYear: number; cvc: string } | undefined;
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (wallet?.virtualCardReady && wallet.stripeCardId) {
        try {
          const { getVirtualCardDetails } = await import("@/lib/stripe");
          const card = await getVirtualCardDetails(wallet.stripeCardId);
          cardDetails = { number: card.number, expMonth: card.expMonth, expYear: card.expYear, cvc: card.cvc };
        } catch {
          // Card details unavailable
        }
      }

      const seatingInstruction = seatingPreference
        ? `If there is a seating preference option (indoor/outdoor/bar/patio), select "${seatingPreference}". `
        : "";

      const cardInstruction = cardDetails
        ? `If a credit card is required, use: Card number ${cardDetails.number}, Exp ${String(cardDetails.expMonth).padStart(2, "0")}/${cardDetails.expYear}, CVC ${cardDetails.cvc}. `
        : "";

      console.error("[RESERVATION:4] Starting reservation for", restaurantName);

      const isOpenTable = reservationUrl.includes("opentable.com");
      const reservationDate = (toolInput as Record<string, unknown>).date as string || new Date().toISOString().split("T")[0];

      let result: Awaited<ReturnType<typeof browseWebsite>>;

      if (isOpenTable) {
        // Use API-based approach: GraphQL search → availability → direct booking URL
        const { completeOpenTableReservation } = await getBrowserbase();
        console.error("[RESERVATION:4a] Using OpenTable API approach");
        result = await completeOpenTableReservation(
          restaurantName,
          reservationDate,
          time,
          partySize,
          { firstName, lastName, email, phone },
          seatingPreference,
        );
      } else {
        const dateObj = new Date(reservationDate + "T12:00:00");
        const dateFormatted = dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        result = await browseWebsite(
          reservationUrl,
          `Complete a restaurant reservation. Follow these steps EXACTLY:\n` +
          `1. The page should show ${restaurantName} with ${partySize} people.\n` +
          `2. Look for available time slots near ${time}. Click on the time slot closest to ${time}.\n` +
          `3. ${seatingInstruction}If there is a seating preference dropdown or option and no preference was specified, leave it as the default.\n` +
          `4. You should reach a form asking for diner details. Fill in:\n` +
          `   - First name: ${firstName}\n` +
          `   - Last name: ${lastName}\n` +
          `   - Email: ${email}\n` +
          `   - Phone: ${phone}\n` +
          `5. ${cardInstruction}\n` +
          `6. If there are any special requests or notes fields, leave them empty.\n` +
          `7. Review the reservation details, then click the final "Complete reservation" or "Confirm" button.\n` +
          `8. After clicking confirm, wait for the confirmation page to load.\n` +
          `9. Return "done" with: CONFIRMED: [restaurant name] | DATE: [date] | TIME: [time selected] | PARTY: [number] | CONFIRMATION: [any confirmation number shown]\n` +
          `If you cannot complete the reservation (no times available, error, etc.), return: FAILED: [reason]\n` +
          `IMPORTANT: Do NOT stop before clicking the final confirm button. Complete the entire booking.`,
          { name: user?.name || "", email, phone, address: user?.homeAddress || "" },
          undefined,
          undefined,
          { allowFinalSubmit: true }
        );
      }

      console.error("[RESERVATION:5] browseWebsite returned", JSON.stringify({ success: result.success, summary: result.summary, error: result.error, url: result.currentUrl }));
      if (result.success && result.summary) {
        const confirmed = result.summary.includes("CONFIRMED");
        const timeMatch = result.summary.match(/TIME:\s*(.+?)(?:\s*\||$)/i);
        const confMatch = result.summary.match(/CONFIRMATION:\s*(.+?)(?:\s*\||$)/i);

        if (confirmed) {
          return JSON.stringify({
            success: true,
            restaurant: restaurantName,
            timeBooked: timeMatch ? timeMatch[1].trim() : time,
            partySize,
            confirmationNumber: confMatch ? confMatch[1].trim() : null,
            summary: result.summary,
          });
        }
      }

      return JSON.stringify({
        success: false,
        restaurant: restaurantName,
        error: result.summary || "Could not complete the reservation",
        fallbackUrl: reservationUrl,
      });
    } catch (e) {
      console.error("[RESERVATION:ERROR] complete_reservation threw:", String(e), (e as Error)?.stack);
      return JSON.stringify({
        success: false,
        restaurant: restaurantName,
        error: "Reservation booking failed",
        detail: String(e),
        fallbackUrl: reservationUrl,
      });
    }
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

  if (toolName === "add_calendar_event") {
    const { title, date, startTime, endTime, location, description } = toolInput as {
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      location?: string;
      description?: string;
    };

    try {
      const startDateTime = `${date}T${startTime}:00`;
      let end = endTime;
      if (!end) {
        const [h, m] = startTime.split(":").map(Number);
        const endH = (h + 1) % 24;
        end = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
      const endDateTime = `${date}T${end}:00`;

      const result = await createCalendarEvent(userId, title, startDateTime, endDateTime, location, description);
      if (!result) {
        return JSON.stringify({ success: false, error: "Could not create event — Google Calendar may not be connected or authorized." });
      }
      return JSON.stringify({ success: true, eventId: result.id, calendarLink: result.htmlLink, title, date, startTime, endTime: end });
    } catch (e) {
      return JSON.stringify({ success: false, error: "Failed to create calendar event", detail: String(e) });
    }
  }

  return JSON.stringify({ error: "Unknown tool" });
}

export const maxDuration = 300;

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

FOOD ORDERING FLOW — DoorDash delivery:
When ${name} asks to order food (any restaurant, any food):
1. Call search_restaurants with the restaurant name AND their location — this returns INSTANTLY with the restaurant info, DoorDash link, and pricing
2. Using the search result, immediately confirm the order back to them. Do NOT call browse_menu — just use the pricing from search_restaurants. Present it confidently:
   "on it! here's your order:
   - **chicken burrito bowl** (rice, black beans, corn salsa, sour cream, cheese) — ~$11.75
   - **delivery fee** — ~$2.99
   - **estimated total with tax: ~$16-18**
   want me to place it?"
3. If their wallet has enough funds and they confirm → call spend_wallet to debit the amount, then tell them it's placed
4. If their wallet is low → tell them exactly how much to add: "your balance is $X — add about $Y in the wallet tab and I'll place it"

CRITICAL RULES for food orders:
- NEVER mention browser tools, technical issues, hiccups, snags, or anything breaking. You are a concierge — present the order smoothly and confidently.
- NEVER tell them to open DoorDash, download an app, or go to a website. YOU handle it.
- NEVER call browse_menu — you already have the full menu with prices from search_restaurants. Use that data directly.
- If ${name} already said what they want with customizations (e.g. "with rice, black beans, corn salsa"), repeat those customizations back in the confirmation so they know you heard them.
- When they say "delivered to my house" or "to my place", use their saved address. Don't ask for it again.
- Respond in under 5 seconds. The search is instant — don't add artificial delays.
- The menu field in search results has real item names and prices. Use those exact prices.
- Be specific and confident: "$11.75" not "around $11-14"
- ASSUME SMART DEFAULTS: If they say "Chipotle" without specifying burrito vs bowl, assume burrito bowl (most popular). If they don't say a protein, assume chicken (most popular). Don't ask multiple clarifying questions — just confirm the order with your best guess and let them correct you if needed. ONE question max if truly ambiguous.
- Keep the confirmation SHORT: item + customizations + price + delivery fee + total. That's it. Ask "want me to place it?" Done.

RESTAURANT RESERVATIONS — you book the table, ${name} just shows up:
When ${name} asks to make a reservation, get a table, book a spot, or anything involving dining out at a sit-down restaurant:
1. ALWAYS call make_reservation first. Today is ${new Date().toISOString().split("T")[0]}. Convert relative dates ("tomorrow" = next day, "this Friday" = upcoming Friday) to YYYY-MM-DD. Convert times to 24-hour (7pm → 19:00). Default party of 2.
2. After make_reservation returns, confirm details and ask seating preference. DO NOT show the reservationUrl as a link. Example:
   "booking **Ledger** for **2** tomorrow at **7pm** — do you have a seating preference? inside, outside, bar?"
3. Once ${name} confirms or specifies a preference, you MUST call complete_reservation. Pass it the reservationUrl from make_reservation. Say "on it, booking now — give me about 30 seconds..."
4. On success: "you're all set! **Ledger**, Thursday June 25 at 7:00 PM, party of 2. just show up and enjoy."
5. On failure: "couldn't finish the booking automatically — [tap here to complete it](fallbackUrl)"

ABSOLUTE RULES — NEVER BREAK THESE:
- NEVER present a link or URL to the user for reservations. You book it FOR them using complete_reservation.
- NEVER say "tap here", "click here", "here's your link", or "book your table" with a URL. That defeats the entire purpose.
- NEVER skip complete_reservation. When the user says "go ahead", "book it", "inside please", or confirms in any way, you MUST call complete_reservation.
- The reservationUrl from make_reservation is INTERNAL — it goes to complete_reservation, not to the user.
- complete_reservation takes 30-60 seconds (browser automation). Warn them to wait.
- The virtual card from their wallet is used automatically if needed.
- The goal: ${name} says what they want → you handle EVERYTHING → they just show up.

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

CALENDAR — you have full access to ${name}'s calendar (read AND write):
- The upcoming 7 days are already loaded above. For anything within this week, just answer from that data.
- For ANY other date — next week, next month, a specific date — use the check_calendar tool. It pulls from Google Calendar AND any imported calendars (iCloud, Outlook, Yahoo, etc.).
- When ${name} says "next Tuesday", "July 4th", "this weekend", "am I free tomorrow afternoon", etc. — look it up and give a real answer.
- To ADD events: use the add_calendar_event tool. When ${name} says "add a meeting", "put that on my calendar", "schedule X on Tuesday at 3pm", etc. — create the event. Extract the title, date (YYYY-MM-DD), start time (HH:MM 24h), and optionally end time, location, and description. If no end time is given, default to 1 hour. Confirm what you added after creating it.
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
