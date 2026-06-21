import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { amount } = await req.json();
  const cents = Math.round(amount * 100);
  if (!cents || cents < 100 || cents > 50000) {
    return Response.json({ error: "Amount must be between $1 and $500" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) {
    return Response.json({ error: "No payment method on file" }, { status: 400 });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet?.defaultPaymentMethod) {
    return Response.json({ error: "No payment method on file" }, { status: 400 });
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: cents,
    currency: "usd",
    customer: user.stripeCustomerId,
    payment_method: wallet.defaultPaymentMethod,
    off_session: true,
    confirm: true,
  });

  if (paymentIntent.status !== "succeeded") {
    return Response.json({ error: "Payment failed" }, { status: 400 });
  }

  const updated = await prisma.wallet.update({
    where: { userId },
    data: { balance: { increment: amount } },
  });

  await prisma.transaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type: "deposit",
      description: `Added $${amount.toFixed(2)} via ${wallet.cardBrand || "card"} •••• ${wallet.cardLast4 || "****"}`,
    },
  });

  return Response.json({ balance: updated.balance });
}
