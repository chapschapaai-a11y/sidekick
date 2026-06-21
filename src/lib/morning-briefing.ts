import { prisma } from "@/lib/db";
import { fetchTodayEvents, CalendarEvent } from "@/lib/google";
import { sendSMS } from "@/lib/twilio";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

interface WeatherInfo {
  location: string;
  temperature: number;
  feelsLike: number;
  high: number;
  low: number;
  condition: string;
  icon: string;
}

async function getWeather(location: string, lat?: number | null, lon?: number | null): Promise<WeatherInfo | null> {
  try {
    let latitude = lat;
    let longitude = lon;
    let locationLabel = location;

    if (!latitude || !longitude) {
      const city = location.split(",")[0].trim();
      const geoRes = await fetch(`${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`);
      const geoData = await geoRes.json();
      const geo = geoData.results?.[0];
      if (!geo) return null;
      latitude = geo.latitude;
      longitude = geo.longitude;
      locationLabel = `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}`;
    }

    const res = await fetch(
      `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    );
    const data = await res.json();
    const current = data.current;
    const daily = data.daily;

    const code = current.weather_code;
    const condition = code === 0 ? "clear" : code <= 3 ? "partly cloudy" : code <= 48 ? "foggy" : code <= 67 ? "rainy" : code <= 77 ? "snowy" : code <= 82 ? "showers" : code <= 99 ? "stormy" : "unknown";
    const icon = code === 0 ? "☀️" : code <= 2 ? "⛅" : code === 3 ? "☁️" : code <= 48 ? "🌫️" : code <= 67 ? "🌧️" : code <= 77 ? "❄️" : code <= 82 ? "🌦️" : code <= 99 ? "⛈️" : "🌡️";

    return {
      location: locationLabel,
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      condition,
      icon,
    };
  } catch {
    return null;
  }
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function buildBriefingContext(
  userName: string,
  sidekickName: string,
  weather: WeatherInfo | null,
  events: CalendarEvent[],
  tasks: { title: string; priority: string; dueDate: Date | null }[],
  walletBalance: number | null,
  connectedApps: string[],
  homeAddress: string | null,
): string {
  const parts: string[] = [];

  parts.push(`You are ${sidekickName}, ${userName}'s personal AI assistant. You're sending their morning briefing text message.`);
  parts.push(`Write a warm, conversational SMS briefing. Be concise — this is a text message, not an email. Use a few emojis naturally. No markdown.`);
  parts.push(`Start with a greeting. Then cover the day ahead.`);

  if (weather) {
    parts.push(`\nWEATHER: ${weather.icon} ${weather.temperature}°F (feels like ${weather.feelsLike}°F), high ${weather.high}°F / low ${weather.low}°F, ${weather.condition} in ${weather.location}`);
  }

  if (events.length > 0) {
    parts.push(`\nCALENDAR (${events.length} events today):`);
    for (const e of events) {
      const time = e.allDay ? "All day" : `${formatTime(e.start)} - ${formatTime(e.end)}`;
      parts.push(`- ${time}: ${e.title}${e.location ? ` (${e.location})` : ""}`);
    }
  } else {
    parts.push(`\nCALENDAR: No events scheduled today — open day.`);
  }

  if (tasks.length > 0) {
    const todayTasks = tasks.filter((t) => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate);
      const now = new Date();
      return due.toDateString() === now.toDateString();
    });
    const highPriority = tasks.filter((t) => t.priority === "high");

    if (todayTasks.length > 0) {
      parts.push(`\nTASKS DUE TODAY: ${todayTasks.map((t) => t.title).join(", ")}`);
    }
    if (highPriority.length > 0) {
      parts.push(`HIGH PRIORITY TASKS: ${highPriority.map((t) => t.title).join(", ")}`);
    }
    if (todayTasks.length === 0 && highPriority.length === 0) {
      parts.push(`\nTASKS: ${tasks.length} open tasks, none urgent today.`);
    }
  }

  if (walletBalance !== null) {
    parts.push(`\nWALLET BALANCE: $${walletBalance.toFixed(2)}`);
  }

  if (connectedApps.length > 0) {
    parts.push(`\nCONNECTED APPS: ${connectedApps.join(", ")}`);
  }

  if (homeAddress) {
    parts.push(`\nHOME ADDRESS: ${homeAddress}`);
  }

  parts.push(`\nINSTRUCTIONS FOR THE BRIEFING:`);
  parts.push(`- Be proactive: if there's a meeting with a location, offer to schedule a ride`);
  parts.push(`- If there are gaps in the schedule (no lunch, no dinner), suggest something`);
  parts.push(`- If they have connected apps, reference what you can do (order food, get a ride, shop)`);
  parts.push(`- If wallet is low, mention it casually`);
  parts.push(`- End with something like "just text me if you need anything today"`);
  parts.push(`- Keep the whole message under 1400 characters (SMS limit)`);
  parts.push(`- Don't use bullet points or lists — write it like a real text from a friend who's also your assistant`);

  return parts.join("\n");
}

export async function generateAndSendBriefing(userId: string): Promise<{ sent: boolean; message?: string; error?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tasks: {
        where: { completed: false },
        orderBy: { priority: "desc" },
        take: 10,
      },
      wallet: { select: { balance: true } },
      integrations: {
        where: { browserContextId: { not: null } },
        select: { provider: true },
      },
    },
  });

  if (!user || !user.phone) {
    return { sent: false, error: "User not found or no phone number" };
  }

  const [weather, events] = await Promise.all([
    getWeather(user.location || "Salem, MA", user.latitude, user.longitude),
    fetchTodayEvents(userId),
  ]);

  const connectedApps = user.integrations.map((i) => {
    const names: Record<string, string> = { ubereats: "Uber Eats", doordash: "DoorDash", lyft: "Lyft", amazon: "Amazon" };
    return names[i.provider] || i.provider;
  });

  const prompt = buildBriefingContext(
    user.name || "there",
    user.sidekickName,
    weather,
    events,
    user.tasks.map((t) => ({ title: t.title, priority: t.priority, dueDate: t.dueDate })),
    user.wallet?.balance ?? null,
    connectedApps,
    user.homeAddress,
  );

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const briefing = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!briefing) {
    return { sent: false, error: "Failed to generate briefing" };
  }

  try {
    await sendSMS(user.phone, briefing);
    return { sent: true, message: briefing };
  } catch (err) {
    return { sent: false, message: briefing, error: `SMS failed: ${err}` };
  }
}

export async function getUsersForBriefing(): Promise<string[]> {
  const now = new Date();

  const users = await prisma.user.findMany({
    where: {
      morningBriefing: true,
      phone: { not: null },
    },
    select: { id: true, wakeTime: true, timezone: true },
  });

  const readyUserIds: string[] = [];

  for (const user of users) {
    const wakeTime = user.wakeTime || "07:00";
    const [wakeHour, wakeMinute] = wakeTime.split(":").map(Number);

    const tz = user.timezone || "America/New_York";
    const userNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const currentHour = userNow.getHours();
    const currentMinute = userNow.getMinutes();

    if (currentHour === wakeHour && currentMinute >= wakeMinute && currentMinute < wakeMinute + 15) {
      readyUserIds.push(user.id);
    }
  }

  return readyUserIds;
}
