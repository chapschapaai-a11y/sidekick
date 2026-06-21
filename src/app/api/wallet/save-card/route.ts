import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { paymentMethodId } = await req.json();
  if (!paymentMethodId) {
    return Response.json({ error: "Missing payment method" }, { status: 400 });
  }

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const last4 = pm.card?.last4 || "****";
  const brand = pm.card?.brand || "card";

  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, balance: 0, defaultPaymentMethod: paymentMethodId, cardLast4: last4, cardBrand: brand },
    });
  } else {
    wallet = await prisma.wallet.update({
      where: { userId },
      data: { defaultPaymentMethod: paymentMethodId, cardLast4: last4, cardBrand: brand },
    });
  }

  return Response.json({ saved: true, cardLast4: last4, cardBrand: brand });
}
