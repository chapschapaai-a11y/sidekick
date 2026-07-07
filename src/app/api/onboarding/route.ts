import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const data = await req.json();

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: data.name || undefined,
      age: data.age || undefined,
      backgrounds: data.backgrounds || undefined,
      formality: data.formality ?? undefined,
      humor: data.humor ?? undefined,
      directness: data.directness ?? undefined,
      energy: data.energy ?? undefined,
      detail: data.detail ?? undefined,
      needs: data.needs || undefined,
      wakeTime: data.wakeTime || undefined,
      commute: data.commute || undefined,
      diet: data.diet || undefined,
      sidekickName: data.sidekickName || undefined,
      morningBriefing: data.morningBriefing ?? undefined,
      smsConsent: data.smsConsent ?? undefined,
      onboarded: data.onboarded ?? undefined,
      location: data.location || undefined,
      latitude: data.latitude ?? undefined,
      longitude: data.longitude ?? undefined,
    },
  });

  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      onboarded: user.onboarded,
      sidekickName: user.sidekickName,
    },
  });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return Response.json({
    name: user.name || "",
    email: user.email,
    phone: user.phone || "",
    age: user.age || 28,
    backgrounds: user.backgrounds,
    formality: user.formality,
    humor: user.humor,
    directness: user.directness,
    energy: user.energy,
    detail: user.detail,
    needs: user.needs,
    wakeTime: user.wakeTime || "",
    commute: user.commute,
    diet: user.diet,
    sidekickName: user.sidekickName,
    morningBriefing: user.morningBriefing,
    smsConsent: user.smsConsent,
    onboarded: user.onboarded,
    location: user.location || "",
    latitude: user.latitude,
    longitude: user.longitude,
  });
}
