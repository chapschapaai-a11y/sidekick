import { prisma } from "@/lib/db";
import { fetchUnreadEmails, fetchSentEmails, createGmailDraft } from "@/lib/google";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function generateDraftsForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { generated: 0, drafts: [] };

  const emails = await fetchUnreadEmails(userId);
  if (emails.length === 0) return { generated: 0, drafts: [] };

  const existing = await prisma.emailDraft.findMany({
    where: { userId, gmailMessageId: { in: emails.map((e) => e.id) } },
    select: { gmailMessageId: true },
  });
  const existingIds = new Set(existing.map((e) => e.gmailMessageId));
  const newEmails = emails.filter((e) => !existingIds.has(e.id));

  if (newEmails.length === 0) return { generated: 0, drafts: [] };

  const triageList = newEmails
    .slice(0, 10)
    .map((e, i) => `[${i}] From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`)
    .join("\n\n");

  const triageResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Which of these emails actually need a human reply? Only include emails where someone is asking a question, making a request, starting a conversation, or expecting a response.

Do NOT include: newsletters, marketing, receipts, order confirmations, shipping notifications, automated alerts, no-reply senders, calendar invites, social media notifications, subscription updates, or promotional emails.

Return ONLY a JSON array of the index numbers that need replies, like [0, 2, 4]. If none need replies, return [].

${triageList}`,
      },
    ],
  });

  let replyIndices: number[] = [];
  try {
    const triageText = triageResponse.content[0].type === "text" ? triageResponse.content[0].text : "[]";
    const match = triageText.match(/\[[\d\s,]*\]/);
    if (match) replyIndices = JSON.parse(match[0]);
  } catch {
    replyIndices = [];
  }

  const actionableEmails = replyIndices
    .filter((i) => i >= 0 && i < newEmails.length)
    .map((i) => newEmails[i]);

  if (actionableEmails.length === 0) return { generated: 0, drafts: [] };

  const sentEmails = await fetchSentEmails(userId, 20);

  const voiceExamples = sentEmails
    .filter((e) => e.body.trim().length > 20)
    .slice(0, 12)
    .map((e, i) => `--- Sent Email ${i + 1} ---\nTo: ${e.to}\nSubject: ${e.subject}\n\n${e.body}`)
    .join("\n\n");

  const firstName = (user.name || "").split(" ")[0] || "Me";

  const systemPrompt = `You are drafting email replies on behalf of ${user.name || "the user"}.

YOUR #1 RULE: Sound exactly like them. Study these real emails they've sent and absorb everything — their greeting style, sign-off, sentence length, punctuation habits, capitalization, slang, emoji usage (or lack of), level of formality, how they open and close, how verbose or terse they are, whether they use "Hey" vs "Hi" vs jumping straight in, whether they sign off with a name or initial or nothing.

${voiceExamples ? `=== REAL EMAILS FROM ${firstName.toUpperCase()} (study these carefully) ===\n\n${voiceExamples}\n\n=== END OF EXAMPLES ===` : "No sent email history available — default to casual, direct, and brief."}

RULES:
- Mirror their EXACT writing patterns. If they use lowercase, you use lowercase. If they're terse, be terse. If they use specific phrases or expressions, use those same patterns.
- Do NOT include a subject line. Just the reply body.
- Sign off exactly the way they sign off in their real emails. If they use "${firstName}", use that. If they use an initial, use that. If they don't sign off at all, don't add one.
- Only draft replies for emails that genuinely need a response — someone asking a question, making a request, or starting a conversation.
- This must read like ${firstName} actually wrote it. Not an AI. Not a template. Them.`;

  const drafts = [];

  for (const email of actionableEmails.slice(0, 5)) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Draft a reply to this email:\n\nFrom: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`,
          },
        ],
      });

      const draftText =
        response.content[0].type === "text" ? response.content[0].text : "";

      if (!draftText.trim()) continue;

      const gmailDraftId = await createGmailDraft(
        userId,
        email.from,
        email.subject,
        draftText,
        email.threadId,
      );

      const saved = await prisma.emailDraft.create({
        data: {
          userId,
          gmailMessageId: email.id,
          gmailDraftId,
          subject: email.subject,
          from: email.from.replace(/<.*>/, "").trim(),
          snippet: email.snippet,
          draftBody: draftText,
        },
      });

      drafts.push(saved);
    } catch {
      continue;
    }
  }

  return { generated: drafts.length, drafts };
}
