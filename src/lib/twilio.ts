import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER!;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits; // let Twilio reject anything else with a clear error
}

export async function sendSMS(to: string, body: string): Promise<string> {
  const e164 = normalizePhone(to);
  console.log(`[Twilio] Sending SMS from ${FROM_NUMBER} to ${e164} (${body.length} chars)`);
  const message = await client.messages.create({
    body,
    from: FROM_NUMBER,
    to: e164,
  });
  console.log(`[Twilio] Message SID: ${message.sid}, Status: ${message.status}`);
  return message.sid;
}
