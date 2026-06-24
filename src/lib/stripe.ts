import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export interface VirtualCardDetails {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  last4: string;
}

export async function createIssuingCardholder(
  name: string,
  email: string,
  phone?: string,
): Promise<string> {
  const cardholder = await stripe.issuing.cardholders.create({
    name,
    email,
    phone_number: phone || undefined,
    type: "individual",
    status: "active",
    billing: {
      address: {
        line1: "354 Oyster Point Blvd",
        city: "South San Francisco",
        state: "CA",
        postal_code: "94080",
        country: "US",
      },
    },
  });
  return cardholder.id;
}

export async function createVirtualCard(
  cardholderId: string,
  spendingLimitCents: number,
): Promise<{ cardId: string; last4: string }> {
  const card = await stripe.issuing.cards.create({
    cardholder: cardholderId,
    currency: "usd",
    type: "virtual",
    status: "active",
    spending_controls: {
      spending_limits: [
        {
          amount: spendingLimitCents,
          interval: "all_time",
        },
      ],
    },
  });
  return { cardId: card.id, last4: card.last4 };
}

export async function getVirtualCardDetails(
  cardId: string,
): Promise<VirtualCardDetails> {
  const card = await stripe.issuing.cards.retrieve(cardId, {
    expand: ["number", "cvc"],
  });
  return {
    number: (card as unknown as { number: string }).number,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    cvc: (card as unknown as { cvc: string }).cvc,
    last4: card.last4,
  };
}

export async function updateCardSpendingLimit(
  cardId: string,
  newLimitCents: number,
): Promise<void> {
  await stripe.issuing.cards.update(cardId, {
    spending_controls: {
      spending_limits: [
        {
          amount: newLimitCents,
          interval: "all_time",
        },
      ],
    },
  });
}
