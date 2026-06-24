import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: {
      transactions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, balance: 0 },
      include: {
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
  }

  return Response.json({
    balance: wallet.balance,
    cardLast4: wallet.cardLast4,
    cardBrand: wallet.cardBrand,
    virtualCardReady: wallet.virtualCardReady,
    virtualCardLast4: wallet.virtualCardLast4,
    transactions: wallet.transactions,
  });
}
