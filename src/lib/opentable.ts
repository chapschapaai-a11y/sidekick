const AUTOCOMPLETE_HASH = "fe1d118abd4c227750693027c2414d43014c2493f64f49bcef5a65274ce9c3c3";
const AVAILABILITY_HASH = "436770d3236803f6bb7e8bdfc7b617a582026235c1a6af52297ab63fed08aa0c";
const GQL_URL = "https://www.opentable.com/dapi/fe/gql";

const DEFAULT_LAT = 42.5195;
const DEFAULT_LNG = -70.8967;

export interface OTSlot {
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

export interface OTAvailability {
  restaurant: OTRestaurant;
  slots: OTSlot[];
  date: string;
  partySize: number;
}

async function getCSRFAndCookies(): Promise<{ csrf: string; cookies: string }> {
  const res = await fetch("https://www.opentable.com", {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  const cookies = (res.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  const html = await res.text();

  const csrfMatch = html.match(/"__CSRF_TOKEN__"\s*:\s*"([^"]+)"/) ||
    html.match(/__CSRF_TOKEN__\s*=\s*["']([^"']+)["']/);
  const csrf = csrfMatch?.[1] || "";

  console.error("[OT] CSRF:", csrf ? csrf.slice(0, 10) + "..." : "MISSING");
  return { csrf, cookies };
}

export async function searchRestaurant(query: string): Promise<OTRestaurant | null> {
  const { csrf, cookies } = await getCSRFAndCookies();
  if (!csrf) return null;

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
    console.error("[OT] Autocomplete failed:", res.status);
    return null;
  }

  const data = await res.json();
  const allResults = data?.data?.autocomplete?.autocompleteResults || [];
  const restaurants = allResults.filter((r: Record<string, string>) => r.type === "Restaurant");

  if (restaurants.length === 0) return null;

  // Fuzzy name matching
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

  console.error("[OT] Found:", best.name, "ID:", best.id);
  return { id: parseInt(best.id as string, 10), name: best.name as string };
}

// Availability needs a real browser (Akamai blocks server-side calls)
// This function runs inside Browserbase's page.evaluate()
export function getAvailabilityScript(rid: number, date: string, time: string, partySize: number) {
  return {
    rid,
    date,
    time,
    partySize,
    hash: AVAILABILITY_HASH,
  };
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
