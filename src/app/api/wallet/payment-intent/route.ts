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

  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user?.email,
      name: user?.name || undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: cents,
    currency: "usd",
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    metadata: { userId, type: "wallet_deposit" },
  });

  return Response.json({
    clientSecret: paymentIntent.client_secret,
  });
}
