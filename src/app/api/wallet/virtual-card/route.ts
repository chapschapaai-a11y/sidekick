import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createIssuingCardholder,
  createVirtualCard,
  updateCardSpendingLimit,
} from "@/lib/stripe";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    return Response.json({ error: "No wallet found" }, { status: 404 });
  }

  if (wallet.virtualCardReady && wallet.stripeCardId) {
    return Response.json({
      ready: true,
      last4: wallet.virtualCardLast4,
      message: "Virtual card already provisioned",
    });
  }

  try {
    let cardholderId = wallet.stripeCardholderId;

    if (!cardholderId) {
      cardholderId = await createIssuingCardholder(
        user.name || user.email,
        user.email,
        user.phone || undefined,
      );
    }

    const balanceCents = Math.round(wallet.balance * 100);
    const { cardId, last4 } = await createVirtualCard(
      cardholderId,
      Math.max(balanceCents, 100),
    );

    await prisma.wallet.update({
      where: { userId },
      data: {
        stripeCardholderId: cardholderId,
        stripeCardId: cardId,
        virtualCardLast4: last4,
        virtualCardReady: true,
      },
    });

    return Response.json({
      ready: true,
      last4,
      message: "Virtual card created successfully",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json(
      { error: `Failed to create virtual card: ${message}` },
      { status: 500 },
    );
  }
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    return Response.json({ ready: false });
  }

  return Response.json({
    ready: wallet.virtualCardReady,
    last4: wallet.virtualCardLast4,
    hasBalance: wallet.balance > 0,
    balance: wallet.balance,
  });
}
