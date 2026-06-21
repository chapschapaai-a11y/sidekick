import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { paymentIntentId } = await req.json();
  if (!paymentIntentId) {
    return Response.json({ error: "Missing payment intent" }, { status: 400 });
  }

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== "succeeded") {
    return Response.json({ error: "Payment not completed" }, { status: 400 });
  }

  if (pi.metadata.userId !== userId) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const amount = pi.amount / 100;

  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { userId, balance: amount } });
  } else {
    wallet = await prisma.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });
  }

  const pm = pi.payment_method
    ? await stripe.paymentMethods.retrieve(pi.payment_method as string)
    : null;

  const label = pm?.card
    ? `${pm.card.brand} •••• ${pm.card.last4}`
    : pm?.type === "link" ? "Link" : "Apple Pay / Google Pay";

  await prisma.transaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type: "deposit",
      description: `Added $${amount.toFixed(2)} via ${label}`,
    },
  });

  return Response.json({ balance: wallet.balance });
}
