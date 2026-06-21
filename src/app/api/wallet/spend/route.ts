import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { amount, description, vendor } = await req.json();
  if (!amount || amount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (!description) {
    return Response.json({ error: "Description required" }, { status: 400 });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    return Response.json({ error: "No wallet found" }, { status: 404 });
  }

  if (wallet.balance < amount) {
    return Response.json(
      {
        error: "Insufficient funds",
        balance: wallet.balance,
        needed: amount,
      },
      { status: 400 }
    );
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

  return Response.json({
    success: true,
    balance: updated.balance,
    spent: amount,
    description,
  });
}
