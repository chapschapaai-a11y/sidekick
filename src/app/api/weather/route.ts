import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

const US_STATES: Record<string, string> = {
  AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA",
  CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE", FL: "FLORIDA", GA: "GEORGIA",
  HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS", IN: "INDIANA", IA: "IOWA",
  KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA", ME: "MAINE", MD: "MARYLAND",
  MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA", MS: "MISSISSIPPI", MO: "MISSOURI",
  MT: "MONTANA", NE: "NEBRASKA", NV: "NEVADA", NH: "NEW HAMPSHIRE", NJ: "NEW JERSEY",
  NM: "NEW MEXICO", NY: "NEW YORK", NC: "NORTH CAROLINA", ND: "NORTH DAKOTA", OH: "OHIO",
  OK: "OKLAHOMA", OR: "OREGON", PA: "PENNSYLVANIA", RI: "RHODE ISLAND", SC: "SOUTH CAROLINA",
  SD: "SOUTH DAKOTA", TN: "TENNESSEE", TX: "TEXAS", UT: "UTAH", VT: "VERMONT",
  VA: "VIRGINIA", WA: "WASHINGTON", WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING",
};

interface GeoResult {
  name: string;
  admin1?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { location: true, latitude: true, longitude: true },
  });

  try {
    let lat: number;
    let lon: number;
    let locationLabel: string;

    if (user?.latitude && user?.longitude) {
      lat = user.latitude;
      lon = user.longitude;
      locationLabel = user.location || "Your location";
    } else {
      const location = user?.location || "Salem, MA";
      const parts = location.split(",").map((s) => s.trim());
      const cityName = parts[0];
      const stateOrCountry = parts[1]?.toUpperCase();

      const geoRes = await fetch(
        `${GEOCODE_URL}?name=${encodeURIComponent(cityName)}&count=50&language=en&format=json`
      );
      const geoData = await geoRes.json();
      const allResults: GeoResult[] = geoData.results || [];

      let geo = allResults[0];
      if (stateOrCountry && allResults.length > 1) {
        const expanded = US_STATES[stateOrCountry];
        const match = allResults.find((r) => {
          const a = r.admin1?.toUpperCase() || "";
          return (
            a === stateOrCountry ||
            a.startsWith(stateOrCountry) ||
            (expanded && a.startsWith(expanded)) ||
            r.country_code?.toUpperCase() === stateOrCountry
          );
        });
        if (match) geo = match;
      }

      if (!geo) {
        return Response.json({ error: "Location not found" }, { status: 404 });
      }

      lat = geo.latitude;
      lon = geo.longitude;
      locationLabel = `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}`;
    }

    const weatherRes = await fetch(
      `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    );
    const weather = await weatherRes.json();

    const current = weather.current;
    const daily = weather.daily;

    return Response.json({
      location: locationLabel,
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      uvIndex: Math.round(current.uv_index),
      condition: weatherCodeToCondition(current.weather_code),
      icon: weatherCodeToIcon(current.weather_code),
    });
  } catch {
    return Response.json({ error: "Weather unavailable" }, { status: 502 });
  }
}

function weatherCodeToCondition(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

function weatherCodeToIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "⛅";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  if (code <= 99) return "⛈️";
  return "🌡️";
}
