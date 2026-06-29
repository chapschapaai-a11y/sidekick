import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Consent — Sidekick",
  description: "SMS messaging terms and opt-in consent for Sidekick by TD Athletes Edge",
};

export default function SMSConsentPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#e8e0d4",
        backgroundColor: "#0D0D0F",
        minHeight: "100vh",
        lineHeight: 1.7,
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 600,
          marginBottom: 8,
          color: "#D4A843",
        }}
      >
        Sidekick SMS Messaging Terms
      </h1>
      <p style={{ color: "#a09888", marginBottom: 32, fontSize: 14 }}>
        Last updated: June 28, 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          What is Sidekick?
        </h2>
        <p>
          Sidekick is a personal AI assistant built by TD Athletes Edge. It helps you manage your
          calendar, tasks, reservations, orders, and more — all through a simple chat interface.
          Sidekick may send you SMS messages for appointment reminders, reservation confirmations,
          task notifications, and other updates related to your account activity.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          How You Opt In
        </h2>
        <p>
          By creating a Sidekick account and providing your phone number during onboarding, you
          consent to receive SMS messages from Sidekick at the phone number you provided. You may
          also opt in by texting START or HELLO to our phone number. Your consent is not a
          condition of any purchase.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          Types of Messages
        </h2>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Reservation and appointment confirmations</li>
          <li>Calendar reminders and schedule updates</li>
          <li>Task and to-do notifications</li>
          <li>Order and delivery status updates</li>
          <li>Account and security alerts</li>
          <li>Responses to your requests made through the Sidekick chat</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          Message Frequency
        </h2>
        <p>
          Message frequency varies based on your activity and preferences. You may receive
          multiple messages per day depending on your calendar, tasks, and requests. On average,
          users receive 2–10 messages per week.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          How to Opt Out
        </h2>
        <p>
          You can opt out at any time by texting <strong>STOP</strong> to our phone number. You
          will receive a confirmation message and no further SMS messages will be sent. You can
          also disable SMS notifications in your Sidekick account settings or contact us directly.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          Help
        </h2>
        <p>
          For help, text <strong>HELP</strong> to our phone number, or contact us at{" "}
          <a href="mailto:cchapa@tdathletesedge.com" style={{ color: "#D4A843" }}>
            cchapa@tdathletesedge.com
          </a>
          .
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          Costs
        </h2>
        <p>
          Message and data rates may apply. Sidekick does not charge for SMS messages, but your
          mobile carrier may charge standard messaging fees.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" }}>
          Privacy
        </h2>
        <p>
          Your phone number and personal information will not be shared with third parties for
          marketing purposes. We use your phone number solely to deliver the Sidekick service. For
          more information, see our{" "}
          <a href="/privacy" style={{ color: "#D4A843" }}>
            Privacy Policy
          </a>
          .
        </p>
      </section>

      <section
        style={{
          marginTop: 40,
          paddingTop: 24,
          borderTop: "1px solid #2a2a2e",
          fontSize: 14,
          color: "#a09888",
        }}
      >
        <p>
          <strong style={{ color: "#f0e8dc" }}>Sidekick</strong> is operated by TD Athletes Edge
          <br />
          Contact:{" "}
          <a href="mailto:cchapa@tdathletesedge.com" style={{ color: "#D4A843" }}>
            cchapa@tdathletesedge.com
          </a>
          <br />
          Phone number: +1 (833) 408-8051
        </p>
      </section>
    </main>
  );
}
