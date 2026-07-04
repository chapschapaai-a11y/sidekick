import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Sidekick",
  description: "Privacy policy for Sidekick by TD Athletes Edge",
};

const heading = { fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#f0e8dc" } as const;
const section = { marginBottom: 32 } as const;

export default function PrivacyPage() {
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
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8, color: "#D4A843" }}>
        Sidekick Privacy Policy
      </h1>
      <p style={{ color: "#a09888", marginBottom: 32, fontSize: 14 }}>
        Last updated: July 4, 2026
      </p>

      <section style={section}>
        <h2 style={heading}>Who We Are</h2>
        <p>
          Sidekick is a personal AI assistant operated by TD Athletes Edge. This policy explains
          what information we collect, how we use it, and the choices you have.
        </p>
      </section>

      <section style={section}>
        <h2 style={heading}>Information We Collect</h2>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Account information: name, email address, phone number, and preferences you provide during onboarding</li>
          <li>Content you share with your Sidekick: messages, tasks, and requests</li>
          <li>Connected service data you authorize: calendar events, email metadata, and similar data from services you link (e.g. Google)</li>
          <li>Payment information for wallet features, processed securely by Stripe — we never store full card numbers</li>
          <li>Basic usage data to keep the service reliable and secure</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={heading}>How We Use Your Information</h2>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>To provide the Sidekick service: answering requests, managing your calendar and tasks, sending briefings and reminders</li>
          <li>To send SMS messages you have explicitly opted into (see our <a href="/sms-consent" style={{ color: "#D4A843" }}>SMS Terms</a>)</li>
          <li>To complete actions you request, such as reservations and orders</li>
          <li>To secure accounts and prevent abuse</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={heading}>What We Do NOT Do</h2>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>We do not sell your personal information</li>
          <li>We do not share your phone number or mobile opt-in data with third parties or affiliates for marketing or promotional purposes</li>
          <li>We do not send marketing texts — SMS is used solely to deliver the service you signed up for</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={heading}>Sharing With Service Providers</h2>
        <p>
          We use trusted providers to operate Sidekick — such as messaging delivery (Twilio),
          payments (Stripe), and cloud hosting (Vercel). They process data only as needed to
          provide their services to us, and text messaging originator opt-in data and consent are
          never shared with any third party for their own use.
        </p>
      </section>

      <section style={section}>
        <h2 style={heading}>Data Retention &amp; Your Choices</h2>
        <p>
          We keep your data while your account is active. You can opt out of SMS anytime by
          replying STOP, disconnect linked services in the app, or request deletion of your
          account and data by emailing us. We will honor deletion requests within 30 days.
        </p>
      </section>

      <section style={section}>
        <h2 style={heading}>Security</h2>
        <p>
          Data is encrypted in transit and at rest. Access to personal information is limited to
          what is required to operate the service.
        </p>
      </section>

      <section style={section}>
        <h2 style={heading}>Children</h2>
        <p>Sidekick is not intended for anyone under 16, and we do not knowingly collect data from children.</p>
      </section>

      <section style={section}>
        <h2 style={heading}>Contact</h2>
        <p>
          Questions or requests:{" "}
          <a href="mailto:cchapa@tdathletesedge.com" style={{ color: "#D4A843" }}>
            cchapa@tdathletesedge.com
          </a>
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
          <a href="/sms-consent" style={{ color: "#D4A843" }}>SMS Messaging Terms</a>
        </p>
      </section>
    </main>
  );
}
