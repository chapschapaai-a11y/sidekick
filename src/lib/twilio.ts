import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER!;

export async function sendSMS(to: string, body: string): Promise<string> {
  console.log(`[Twilio] Sending SMS from ${FROM_NUMBER} to ${to} (${body.length} chars)`);
  const message = await client.messages.create({
    body,
    from: FROM_NUMBER,
    to,
  });
  console.log(`[Twilio] Message SID: ${message.sid}, Status: ${message.status}`);
  return message.sid;
}
