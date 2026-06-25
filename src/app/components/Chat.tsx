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
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const scrollToBottom = useCallback(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
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
    if (lower.match(/order.*from\s+(pizza|chipotle|domino|panera|mcdonald|taco|wendy|subway|chick-fil|starbuck|dunkin)/i)) {
      setTypingStatus("browsing the website & building your order...");
      setTimeout(() => { if (isTyping) setTypingStatus("still working — navigating menus..."); }, 15000);
      setTimeout(() => { if (isTyping) setTypingStatus("almost there — adding items to cart..."); }, 30000);
    } else if (lower.match(/order|food|pizza|burger|sushi|thai|chinese|mexican|delivery|doordash|uber eats|hungry/)) {
      setTypingStatus("searching restaurants...");
    } else if (lower.match(/menu|what do they have|what's on the menu/)) {
      setTypingStatus("browsing menu...");
    } else if (lower.match(/reserv|table for|dinner at|book.*restaurant|get me.*at\s/)) {
      setTypingStatus("looking up the restaurant...");
    } else if (lower.match(/inside|outside|patio|bar seat|no preference|outdoor|indoor/)) {
      setTypingStatus("booking your table...");
      setTimeout(() => { if (isTyping) setTypingStatus("navigating the reservation site..."); }, 10000);
      setTimeout(() => { if (isTyping) setTypingStatus("filling in your details..."); }, 30000);
      setTimeout(() => { if (isTyping) setTypingStatus("almost there — confirming..."); }, 50000);
    } else if (lower.match(/buy|amazon|purchase|order me/)) {
      setTypingStatus("searching products...");
    } else if (lower.match(/yes|grab it|do it|go ahead|confirm|place the order|place it|approve/)) {
      setTypingStatus("placing your order...");
      setTimeout(() => { if (isTyping) setTypingStatus("completing checkout..."); }, 10000);
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
          <div ref={chatBodyRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
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
                <div
                  className={`max-w-[80%] rounded-[20px] px-4 py-3 text-[15px] leading-relaxed tracking-tight ${
                    msg.role === "user"
                      ? "bg-accent text-white rounded-br-[6px]"
                      : "bg-bg-secondary text-text-primary rounded-bl-[6px]"
                  }`}
                >
                  <MessageContent content={msg.content} />
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
                placeholder="Message..."
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted text-base pl-3 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm disabled:opacity-30 transition-opacity"
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
