import { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/auth";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ELEVENLABS_API_KEY) {
    return Response.json({ error: "STT not configured" }, { status: 503 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "Missing audio" }, { status: 400 });
  }
  if (audio.size > 10 * 1024 * 1024) {
    return Response.json({ error: "Audio too large" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("model_id", "scribe_v1");
  upstream.append("file", audio, "recording.webm");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: upstream,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[STT] ElevenLabs error:", res.status, err);
    return Response.json({ error: "Transcription failed" }, { status: 502 });
  }

  const data = await res.json();
  return Response.json({ text: (data.text || "").trim() });
}
