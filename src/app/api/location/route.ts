import { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { latitude, longitude } = await req.json();
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return Response.json({ error: "Missing coordinates" }, { status: 400 });
  }

  // Reverse-geocode to a readable place name (free, no API key)
  let label: string | null = null;
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const geo = await res.json();
      const city = geo.city || geo.locality || "";
      const region = geo.principalSubdivisionCode?.split("-")[1] || geo.principalSubdivision || "";
      if (city) label = region ? `${city}, ${region}` : city;
    }
  } catch {
    // Reverse geocoding is best-effort; coordinates alone still fix the weather
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      latitude,
      longitude,
      ...(label ? { location: label } : {}),
    },
  });

  return Response.json({ success: true, location: label });
}
