const AUTOCOMPLETE_HASH = "fe1d118abd4c227750693027c2414d43014c2493f64f49bcef5a65274ce9c3c3";
const AVAILABILITY_HASH = "436770d3236803f6bb7e8bdfc7b617a582026235c1a6af52297ab63fed08aa0c";
const GQL_URL = "https://www.opentable.com/dapi/fe/gql";

// Salem, MA default coords
const DEFAULT_LAT = 42.5195;
const DEFAULT_LNG = -70.8967;

interface OTSlot {
  time: string;
  slotHash: string;
  availabilityToken: string;
  type: string;
  offsetMinutes: number;
}

interface OTRestaurant {
  id: number;
  name: string;
}

interface OTAvailability {
  restaurant: OTRestaurant;
  slots: OTSlot[];
  date: string;
  partySize: number;
}

export interface ReservationResult {
  success: boolean;
  bookingUrl?: string;
  restaurant?: string;
  time?: string;
  date?: string;
  partySize?: number;
  error?: string;
}

async function getCSRFToken(): Promise<{ csrf: string; cookies: string }> {
  const res = await fetch("https://www.opentable.com", {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  const cookies = res.headers.getSetCookie?.()?.join("; ") || "";
  const html = await res.text();

  // Extract CSRF token from the HTML — it's set as window.__CSRF_TOKEN__
  const csrfMatch = html.match(/__CSRF_TOKEN__\s*=\s*["']([^"']+)["']/);
  const csrf = csrfMatch?.[1] || "";

  console.error("[OT-DIRECT] CSRF:", csrf ? csrf.slice(0, 10) + "..." : "MISSING", "Cookies:", cookies.length > 0 ? "present" : "MISSING");
  return { csrf, cookies };
}

async function searchRestaurant(query: string, csrf: string, cookies: string): Promise<OTRestaurant | null> {
  const res = await fetch(`${GQL_URL}?optype=query&opname=Autocomplete`, {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "cookie": cookies,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "origin": "https://www.opentable.com",
      "referer": "https://www.opentable.com/",
    },
    body: JSON.stringify({
      operationName: "Autocomplete",
      variables: { term: query, latitude: DEFAULT_LAT, longitude: DEFAULT_LNG, useNewVersion: true },
      extensions: { persistedQuery: { version: 1, sha256Hash: AUTOCOMPLETE_HASH } },
    }),
  });

  if (!res.ok) {
    console.error("[OT-DIRECT] Autocomplete failed:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = await res.json();
  const allResults = data?.data?.autocomplete?.autocompleteResults || [];
  const restaurants = allResults.filter((r: Record<string, string>) => r.type === "Restaurant");

  if (restaurants.length === 0) {
    console.error("[OT-DIRECT] No restaurants found for:", query);
    return null;
  }

  // Fuzzy name matching — results aren't relevance-ranked
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

  console.error("[OT-DIRECT] Best match:", best.name, "ID:", best.id);
  return { id: parseInt(best.id as string, 10), name: best.name as string };
}

async function getAvailability(
  restaurantId: number,
  date: string,
  time: string,
  partySize: number,
  csrf: string,
  cookies: string,
): Promise<OTSlot[]> {
  const res = await fetch(`${GQL_URL}?optype=query&opname=RestaurantsAvailability`, {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "cookie": cookies,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "origin": "https://www.opentable.com",
      "referer": "https://www.opentable.com/",
    },
    body: JSON.stringify({
      operationName: "RestaurantsAvailability",
      variables: {
        onlyPop: false,
        forwardDays: 0,
        requireTimes: false,
        requireTypes: ["Standard", "Experience"],
        privilegedAccess: [],
        restaurantIds: [restaurantId],
        date,
        time,
        partySize,
        databaseRegion: "NA",
        forwardMinutes: 210,
        backwardMinutes: 210,
        loyaltyRedemptionTiers: [],
      },
      extensions: { persistedQuery: { version: 1, sha256Hash: AVAILABILITY_HASH } },
    }),
  });

  if (!res.ok) {
    console.error("[OT-DIRECT] Availability failed:", res.status, await res.text().catch(() => ""));
    return [];
  }

  const data = await res.json();
  const restaurant = data?.data?.availability?.[0];
  if (!restaurant) return [];

  const slots = restaurant.availabilityDays?.[0]?.slots?.filter((s: { isAvailable: boolean }) => s.isAvailable) || [];

  return slots.map((s: { timeOffsetMinutes: number; slotHash: string; slotAvailabilityToken: string; type: string }) => {
    const [reqH, reqM] = time.split(":").map(Number);
    const totalMinutes = reqH * 60 + reqM + s.timeOffsetMinutes;
    const slotH = Math.floor(totalMinutes / 60);
    const slotM = totalMinutes % 60;
    return {
      time: `${String(slotH).padStart(2, "0")}:${String(slotM).padStart(2, "0")}`,
      slotHash: s.slotHash,
      availabilityToken: s.slotAvailabilityToken,
      type: s.type,
      offsetMinutes: s.timeOffsetMinutes,
    };
  });
}

export async function findOpenTableAvailability(
  restaurantQuery: string,
  date: string,
  time: string,
  partySize: number,
): Promise<OTAvailability | { error: string }> {
  try {
    const { csrf, cookies } = await getCSRFToken();
    if (!csrf) {
      return { error: "Could not get OpenTable session — try again" };
    }

    const restaurant = await searchRestaurant(restaurantQuery, csrf, cookies);
    if (!restaurant) {
      return { error: `Could not find "${restaurantQuery}" on OpenTable` };
    }

    const slots = await getAvailability(restaurant.id, date, time, partySize, csrf, cookies);
    if (slots.length === 0) {
      return { error: `No available times at ${restaurant.name} for ${partySize} on ${date} near ${time}` };
    }

    // Sort by closest to requested time
    slots.sort((a, b) => Math.abs(a.offsetMinutes) - Math.abs(b.offsetMinutes));

    return { restaurant, slots, date, partySize };
  } catch (e) {
    console.error("[OT-DIRECT] Error:", e);
    return { error: `OpenTable search failed: ${String(e)}` };
  }
}

export function buildBookingUrl(
  restaurantId: number,
  slot: OTSlot,
  date: string,
  partySize: number,
): string {
  return `https://www.opentable.com/booking/details?` +
    `availabilityToken=${encodeURIComponent(slot.availabilityToken)}` +
    `&dateTime=${date}T${slot.time}:00` +
    `&partySize=${partySize}` +
    `&rid=${restaurantId}` +
    `&slotHash=${slot.slotHash}` +
    `&st=${slot.type}` +
    `&points=100&pointsType=Standard&resoAttribute=unselected` +
    `&creditCardRequired=false&isModify=false&isMandatory=false&cfe=true`;
}
