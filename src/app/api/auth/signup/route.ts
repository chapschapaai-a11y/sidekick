import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password, name, phone } = await req.json();

  if (!email || !password || password.length < 6) {
    return Response.json(
      { error: "Email and password (6+ chars) required" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name || null, phone: phone || null },
  });

  const token = signToken(user.id);

  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name } });
  res.headers.set(
    "Set-Cookie",
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );
  return res;
}
