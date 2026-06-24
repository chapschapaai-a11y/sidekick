"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentRequestButtonElement,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

interface TransactionItem {
  id: string;
  amount: number;
  type: string;
  description: string;
  vendor: string | null;
  createdAt: string;
}

interface WalletData {
  balance: number;
  cardLast4: string | null;
  cardBrand: string | null;
  virtualCardReady: boolean;
  virtualCardLast4: string | null;
  transactions: TransactionItem[];
}

const QUICK_AMOUNTS = [10, 25, 50, 100];

function WalletInner({ sidekickName }: { sidekickName: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [data, setData] = useState<WalletData | null>(null);
  const [adding, setAdding] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [paymentRequest, setPaymentRequest] =
    useState<ReturnType<typeof stripe extends null ? never : NonNullable<typeof stripe>["paymentRequest"]> | null>(null);
  const [canPaymentRequest, setCanPaymentRequest] = useState(false);
  const [applePayAmount, setApplePayAmount] = useState(25);
  const [activatingCard, setActivatingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const activateVirtualCard = useCallback(async () => {
    setActivatingCard(true);
    setCardError(null);
    try {
      const res = await fetch("/api/wallet/virtual-card", { method: "POST" });
      const result = await res.json();
      if (result.ready) {
        setData((prev) =>
          prev ? { ...prev, virtualCardReady: true, virtualCardLast4: result.last4 } : prev
        );
      } else if (result.error) {
        setCardError(result.error);
      }
    } catch (e) {
      setCardError("Something went wrong. Try again.");
    }
    setActivatingCard(false);
  }, []);

  useEffect(() => {
    fetch("/api/wallet")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!stripe) return;

    const pr = stripe.paymentRequest({
      country: "US",
      currency: "usd",
      total: { label: "Sidekick Wallet", amount: applePayAmount * 100 },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    pr.canMakePayment().then((result) => {
      if (result) {
        setPaymentRequest(pr as typeof paymentRequest);
        setCanPaymentRequest(true);
      }
    });

    pr.on("paymentmethod", async (ev) => {
      const res = await fetch("/api/wallet/payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: applePayAmount }),
      });
      const { clientSecret } = await res.json();

      const { error, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false }
      );

      if (error) {
        ev.complete("fail");
        return;
      }

      ev.complete("success");

      if (paymentIntent?.status === "succeeded") {
        const confirm = await fetch("/api/wallet/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
        });
        const result = await confirm.json();
        if (result.balance !== undefined) {
          setData((prev) =>
            prev ? { ...prev, balance: result.balance } : prev
          );
          fetch("/api/wallet")
            .then((r) => r.json())
            .then(setData)
            .catch(() => {});
        }
      }
    });
  }, [stripe, applePayAmount]);

  const saveCard = useCallback(async () => {
    if (!stripe || !elements) return;
    setSavingCard(true);

    const res = await fetch("/api/wallet/setup", { method: "POST" });
    const { clientSecret } = await res.json();

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) { setSavingCard(false); return; }

    const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: cardElement },
    });

    if (error || !setupIntent?.payment_method) {
      setSavingCard(false);
      return;
    }

    const pmId = typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method.id;

    await fetch("/api/wallet/save-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethodId: pmId }),
    });

    setShowCardForm(false);
    setSavingCard(false);

    fetch("/api/wallet")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [stripe, elements]);

  const quickAdd = useCallback(
    async (amount: number) => {
      if (!data?.cardLast4) {
        setShowCardForm(true);
        return;
      }
      setSelectedAmount(amount);
      setAdding(true);

      try {
        const res = await fetch("/api/wallet/add-funds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount }),
        });
        const result = await res.json();
        if (result.balance !== undefined) {
          setData((prev) =>
            prev ? { ...prev, balance: result.balance } : prev
          );
          fetch("/api/wallet")
            .then((r) => r.json())
            .then(setData)
            .catch(() => {});
        }
      } catch {}
      setAdding(false);
      setSelectedAmount(null);
    },
    [data?.cardLast4]
  );

  const balance = data?.balance ?? 0;

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {/* Header */}
        <div className="pt-6 pb-2 animate-fade-up">
          <div className="text-text-muted text-[11px] font-bold uppercase tracking-widest mb-1">
            sidekick wallet
          </div>
        </div>

        {/* Balance Card */}
        <div
          className="bg-gradient-to-br from-[#2C2C2C] to-[#1A1A1A] rounded-[20px] p-6 mb-5 text-white animate-fade-up"
          style={{ animationDelay: "0.05s" }}
        >
          <div className="text-[#86868b] text-xs uppercase tracking-wider mb-2">
            available balance
          </div>
          <div className="text-[48px] font-bold tracking-tight leading-none mb-1">
            ${balance.toFixed(2)}
          </div>

          {data?.cardLast4 && (
            <div className="text-[#86868b] text-xs mt-2">
              {data.cardBrand} •••• {data.cardLast4}
            </div>
          )}

          {/* Quick-add amounts */}
          <div className="flex gap-2 mt-5">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => quickAdd(amt)}
                disabled={adding}
                className={`flex-1 font-bold py-3 rounded-full text-sm transition-all ${
                  selectedAmount === amt
                    ? "bg-lime text-black scale-95"
                    : "bg-white/10 text-white border border-white/15 hover:bg-white/20"
                } disabled:opacity-50`}
              >
                {selectedAmount === amt ? "..." : `+$${amt}`}
              </button>
            ))}
          </div>
        </div>

        {/* Virtual Card */}
        <div
          className="mb-5 animate-fade-up"
          style={{ animationDelay: "0.07s" }}
        >
          {data?.virtualCardReady ? (
            <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-lime/20 flex items-center justify-center text-lg">
                  💳
                </div>
                <div className="flex-1">
                  <div className="text-text-primary text-sm font-semibold">
                    Virtual Debit Card
                  </div>
                  <div className="text-text-muted text-xs mt-0.5">
                    Visa •••• {data.virtualCardLast4} — used by {sidekickName} at checkout
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-success bg-success/10 px-2 py-1 rounded-full">
                  Active
                </span>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={activateVirtualCard}
                disabled={activatingCard}
                className="w-full bg-white border border-border rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:border-lime/40 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center text-lg">
                    💳
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-text-primary text-sm font-semibold">
                      {activatingCard ? "Creating card..." : "Activate Virtual Card"}
                    </div>
                    <div className="text-text-muted text-xs mt-0.5">
                      {sidekickName} uses this card to pay on any website
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-lime">
                    {activatingCard ? "..." : "Activate"}
                  </span>
                </div>
              </button>
              {cardError && (
                <div className="mt-2 p-3 rounded-xl bg-red-50 text-red-700 text-xs text-center">
                  {cardError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Apple Pay / Google Pay */}
        {canPaymentRequest && paymentRequest && (
          <div className="mb-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
            <div className="text-text-primary text-[15px] font-bold mb-2.5">
              Quick Add
            </div>
            <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <div className="flex gap-2 mb-3">
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setApplePayAmount(amt)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                      applePayAmount === amt
                        ? "bg-accent text-white"
                        : "bg-bg-secondary text-text-primary hover:bg-bg-input"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <PaymentRequestButtonElement
                options={{
                  paymentRequest,
                  style: {
                    paymentRequestButton: { type: "default", theme: "dark", height: "48px" },
                  },
                }}
              />
            </div>
          </div>
        )}

        {/* Add Card Form */}
        {!data?.cardLast4 && !showCardForm && (
          <button
            onClick={() => setShowCardForm(true)}
            className="w-full bg-white border border-border border-dashed rounded-2xl p-5 mb-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-fade-up hover:border-accent/30 transition-colors"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center text-xl">
                💳
              </div>
              <div className="flex-1 text-left">
                <div className="text-text-primary text-sm font-semibold">
                  Add a card
                </div>
                <div className="text-text-muted text-xs mt-0.5">
                  Save a card for instant top-ups
                </div>
              </div>
              <span className="text-xs font-semibold text-info">Add</span>
            </div>
          </button>
        )}

        {showCardForm && (
          <div
            className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 mb-5 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="text-text-primary text-sm font-semibold mb-3">
              Add your card
            </div>
            <div className="border border-border rounded-xl p-3 mb-4">
              <CardElement
                options={{
                  hidePostalCode: true,
                  style: {
                    base: {
                      fontSize: "16px",
                      color: "#1a1a1a",
                      "::placeholder": { color: "#86868b" },
                    },
                  },
                }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveCard}
                disabled={savingCard}
                className="flex-1 bg-accent text-white font-bold py-3 rounded-full text-sm disabled:opacity-50 transition-opacity"
              >
                {savingCard ? "Saving..." : "Save Card"}
              </button>
              <button
                onClick={() => setShowCardForm(false)}
                className="px-4 text-text-muted text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Recent Transactions */}
        <div className="animate-fade-up" style={{ animationDelay: "0.15s" }}>
          <div className="text-text-primary text-[15px] font-bold mb-2.5">
            Recent
          </div>
          <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-[#f0ede8]">
            {data?.transactions && data.transactions.length > 0 ? (
              data.transactions.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center text-lg shrink-0">
                    {t.type === "deposit" ? "💰" : "💸"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary text-sm font-semibold">
                      {t.description}
                    </div>
                    <div className="text-text-muted text-xs">
                      {new Date(t.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold ${
                      t.type === "deposit"
                        ? "text-green-600"
                        : "text-text-primary"
                    }`}
                  >
                    {t.type === "deposit" ? "+" : "-"}$
                    {Math.abs(t.amount).toFixed(2)}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-text-muted text-sm">
                No transactions yet. Add funds to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Wallet({ sidekickName = "Sidekick" }: { sidekickName?: string }) {
  return (
    <Elements stripe={stripePromise}>
      <WalletInner sidekickName={sidekickName} />
    </Elements>
  );
}
