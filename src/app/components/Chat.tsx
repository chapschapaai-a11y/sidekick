"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { SidekickState } from "@/lib/store";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage: string | null;
}

interface Props {
  state: SidekickState;
}

const QUICK_ACTIONS = [
  { icon: "🍳", label: "order food", prompt: "Order me some food" },
  { icon: "📚", label: "buy a book", prompt: "I want to buy a book" },
  { icon: "📅", label: "schedule", prompt: "What's on my schedule today?" },
  { icon: "🔔", label: "remind", prompt: "Remind me to update the deck" },
  { icon: "💳", label: "wallet", prompt: "What's my wallet balance?" },
  { icon: "☀️", label: "weather", prompt: "What's the weather?" },
];

export default function Chat({ state }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typingStatus, setTypingStatus] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) return; // too short — ignore accidental taps
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "recording");
          const res = await fetch("/api/stt", { method: "POST", body: form });
          const data = await res.json();
          if (data.text) {
            sendMessage(data.text);
          }
        } catch {
          // transcription failed — stay quiet, user can retry
        }
        setIsTranscribing(false);
      };
      recorder.start();
      setIsRecording(true);
    } catch {
      // mic permission denied — nothing to do
    }
  }
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function playMessage(text: string, msgId: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingId === msgId) {
      setPlayingId(null);
      return;
    }
    setPlayingId(msgId);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status === 503) { setVoiceEnabled(false); setPlayingId(null); return; }
      if (!res.ok) { setPlayingId(null); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.onerror = () => { setPlayingId(null); URL.revokeObjectURL(url); audioRef.current = null; };
      await audio.play();
    } catch {
      setPlayingId(null);
    }
  }

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);

    fetch("/api/conversations")
      .then((r) => r.json())
      .then((convos: ConversationSummary[]) => {
        setConversations(convos);
        if (convos.length > 0) {
          loadConversation(convos[0].id);
        } else {
          setMessages([welcomeMessage(state.name)]);
        }
      })
      .catch(() => {
        setMessages([welcomeMessage(state.name)]);
      });
  }, [loaded, state.name]);

  function loadConversation(id: string) {
    fetch(`/api/conversations/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setConversationId(data.id);
        setMessages(
          data.messages.map((m: { id: string; role: "user" | "assistant"; content: string; timestamp: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.timestamp),
          }))
        );
        setShowHistory(false);
      });
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([welcomeMessage(state.name)]);
    setShowHistory(false);
    inputRef.current?.focus();
  }

  async function deleteConversation(id: string) {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) {
      startNewChat();
    }
  }

  function refreshConversations() {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {});
  }

  const nearBottomRef = useRef(true);

  const handleChatScroll = useCallback(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    // "Near bottom" = within 120px of the end; only then do we auto-follow new messages
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = chatBodyRef.current;
    if (!el) return;
    if (force || nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    // Always follow your own new message; only follow replies if you're already at the bottom
    const last = messages[messages.length - 1];
    scrollToBottom(last?.role === "user");
  }, [messages, isTyping, scrollToBottom]);

  async function sendMessage(text: string) {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => {
      const filtered = prev.filter((m) => m.id !== "welcome");
      return [...filtered, userMsg];
    });
    setInput("");
    setIsTyping(true);

    const lower = text.trim().toLowerCase();
    const orderStages = () => {
      setTypingStatus("on it...");
      const stages: [number, string][] = [
        [8000, "found the restaurant — setting up your order..."],
        [30000, "ordering through your connected account — about 2 more minutes..."],
        [75000, "adding your items to the cart..."],
        [130000, "checking out with your saved payment..."],
        [200000, "wrapping up — almost there..."],
      ];
      for (const [ms, msg] of stages) setTimeout(() => setTypingStatus(msg), ms);
    };
    if (lower.match(/order|food|pizza|burger|sushi|thai|chinese|mexican|delivery|doordash|uber eats|hungry|chipotle|burrito|bowl/)) {
      orderStages();
    } else if (lower.match(/yes|grab it|do it|go ahead|confirm|place the order|place it|try.*again|approve/)) {
      orderStages();
    } else if (lower.match(/menu|what do they have|what's on the menu/)) {
      setTypingStatus("browsing menu...");
    } else if (lower.match(/reserv|table for|dinner at|book.*restaurant|get me.*at\s/)) {
      setTypingStatus("looking up the restaurant...");
      setTimeout(() => setTypingStatus("checking availability..."), 10000);
    } else if (lower.match(/buy|amazon|purchase|order me/)) {
      setTypingStatus("searching products...");
      setTimeout(() => setTypingStatus("checking real prices..."), 10000);
    } else if (lower.match(/wallet|balance|how much/)) {
      setTypingStatus("checking wallet...");
    } else if (lower.match(/ride|uber|lyft|car|drive me|get me to|take me to|pick me up|drop me off/)) {
      setTypingStatus("searching rides...");
    } else if (lower.match(/address|home|ship.*home|deliver.*home|my house|my place/)) {
      setTypingStatus("saving address...");
    } else {
      setTypingStatus("thinking...");
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), conversationId }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || "hmm, I didn't get a response. try again?",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      if (voiceEnabled && aiMsg.content) {
        playMessage(aiMsg.content, aiMsg.id);
      }
      refreshConversations();
    } catch {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "something went wrong on my end. try again in a sec!",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    }
    setIsTyping(false);
  }

  function handleSend() {
    sendMessage(input);
  }

  function handleQuickAction(prompt: string) {
    sendMessage(prompt);
  }

  const showQuickActions = messages.length <= 1 || (messages.length === 1 && messages[0].id === "welcome");

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#f0f0f0] bg-white">
        <img
          src={`https://api.dicebear.com/9.x/notionists/svg?seed=${state.sidekickName || "Sidekick"}`}
          alt=""
          className="w-9 h-9 rounded-full object-cover"
        />
        <div className="flex-1">
          <h3 className="text-text-primary font-semibold text-base tracking-tight">{state.sidekickName || "Sidekick"}</h3>
          <p className="text-xs text-success font-medium">Online</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (!next && audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
                setPlayingId(null);
              }
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors text-sm ${voiceEnabled ? "text-accent bg-accent/10" : "text-text-muted hover:bg-bg-secondary"}`}
            title={voiceEnabled ? "Voice on — tap to mute" : "Voice off — tap to enable"}
          >
            {voiceEnabled ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            )}
          </button>
          <button
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) refreshConversations(); }}
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-sm"
            title="Chat history"
          >
            {showHistory ? "✕" : "☰"}
          </button>
          <button
            onClick={startNewChat}
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-sm"
            title="New chat"
          >
            +
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3 border-b border-[#f0f0f0]">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Recent Chats</p>
          </div>
          {conversations.length === 0 ? (
            <div className="px-5 py-8 text-center text-text-muted text-sm">
              No conversations yet. Start chatting!
            </div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 px-5 py-3 border-b border-[#f5f5f5] cursor-pointer hover:bg-bg-secondary transition-colors ${
                  c.id === conversationId ? "bg-bg-secondary" : ""
                }`}
              >
                <div className="flex-1 min-w-0" onClick={() => loadConversation(c.id)}>
                  <p className="text-sm font-medium text-text-primary truncate">
                    {c.title || "Untitled"}
                  </p>
                  <p className="text-xs text-text-muted truncate mt-0.5">
                    {c.lastMessage || "No messages"}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {formatRelativeTime(c.updatedAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-text-muted hover:text-red-500 hover:bg-red-50 transition-colors text-xs"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div
            ref={chatBodyRef}
            onScroll={handleChatScroll}
            className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-3"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-up`}
              >
                {msg.role === "assistant" && (
                  <img
                    src={`https://api.dicebear.com/9.x/notionists/svg?seed=${state.sidekickName || "Sidekick"}`}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover shrink-0 mt-1"
                  />
                )}
                <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-[20px] px-4 py-3 text-[15px] leading-relaxed tracking-tight ${
                      msg.role === "user"
                        ? "bg-accent text-white rounded-br-[6px]"
                        : "bg-bg-secondary text-text-primary rounded-bl-[6px]"
                    }`}
                  >
                    <MessageContent content={msg.content} />
                  </div>
                  {msg.role === "assistant" && msg.id !== "welcome" && (
                    <button
                      onClick={() => playMessage(msg.content, msg.id)}
                      className="mt-1 ml-1 flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                      title={playingId === msg.id ? "Stop" : "Play"}
                    >
                      {playingId === msg.id ? (
                        <span className="flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                          playing...
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                          listen
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex gap-2 items-start animate-fade-up">
                <img
                  src={`https://api.dicebear.com/9.x/notionists/svg?seed=${state.sidekickName || "Sidekick"}`}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
                <div className="bg-bg-secondary rounded-[20px] rounded-bl-[6px] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                    {typingStatus && (
                      <span className="text-xs text-text-muted">{typingStatus}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          {showQuickActions && (
            <div className="px-5 pb-2 flex gap-2 overflow-x-auto">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q.label}
                  onClick={() => handleQuickAction(q.prompt)}
                  className="shrink-0 flex items-center gap-1.5 bg-bg-secondary border border-[#e5e5e5] rounded-full px-3.5 py-2 text-[13px] font-medium text-text-primary hover:bg-[#ebebed] transition-colors"
                >
                  <span>{q.icon}</span>
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-4 pb-4 pt-2 border-t border-[#f0f0f2]">
            <div className="flex items-center gap-2 bg-bg-secondary rounded-3xl px-1.5 py-1.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Message..."}
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted text-base pl-3 focus:outline-none"
              />
              <button
                onClick={toggleRecording}
                disabled={isTranscribing}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
                  isRecording
                    ? "bg-red-500 text-white animate-pulse"
                    : isTranscribing
                      ? "bg-bg-secondary text-text-muted"
                      : "bg-transparent text-text-muted hover:text-text-primary"
                }`}
                title={isRecording ? "Tap to stop and send" : "Tap to speak"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
                </svg>
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm disabled:opacity-30 transition-opacity shrink-0"
              >
                ↑
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function welcomeMessage(name: string | null): Message {
  const h = new Date().getHours();
  const greeting = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return {
    id: "welcome",
    role: "assistant",
    content: `good ${greeting}, ${name || "there"}. what can I help you with?`,
    timestamp: new Date(),
  };
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableRows.push(lines[i]);
        i++;
      }

      const dataRows = tableRows.filter((r) => !r.match(/^\s*\|[\s-:|]+\|\s*$/));
      const cells = (row: string) =>
        row.split("|").filter((c) => c.trim()).map((c) => c.trim());

      if (dataRows.length > 0) {
        const headerCells = cells(dataRows[0]);
        let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:14px">';
        tableHtml += "<thead><tr>";
        headerCells.forEach((c) => {
          tableHtml += `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e5e5e5;font-weight:600">${formatInline(c)}</th>`;
        });
        tableHtml += "</tr></thead><tbody>";
        for (let j = 1; j < dataRows.length; j++) {
          const rowCells = cells(dataRows[j]);
          tableHtml += "<tr>";
          rowCells.forEach((c) => {
            tableHtml += `<td style="padding:5px 10px;border-bottom:1px solid #f0f0f0">${formatInline(c)}</td>`;
          });
          tableHtml += "</tr>";
        }
        tableHtml += "</tbody></table>";
        elements.push(tableHtml);
      }
      continue;
    }

    if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        '<ol style="margin:4px 0;padding-left:20px">' +
          listItems.map((item) => `<li style="margin:2px 0">${formatInline(item)}</li>`).join("") +
          "</ol>"
      );
      continue;
    }

    if (line.match(/^[-•]\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•]\s/)) {
        listItems.push(lines[i].replace(/^[-•]\s/, ""));
        i++;
      }
      elements.push(
        '<ul style="margin:4px 0;padding-left:20px">' +
          listItems.map((item) => `<li style="margin:2px 0">${formatInline(item)}</li>`).join("") +
          "</ul>"
      );
      continue;
    }

    elements.push(line === "" ? "<br />" : formatInline(line));
    i++;
  }

  return <span dangerouslySetInnerHTML={{ __html: elements.join("<br />") }} />;
}

function formatInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#4A90D9;text-decoration:underline">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}
