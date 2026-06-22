"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  state: { name: string; sidekickName: string };
  onNavigate: (tab: "home" | "chat" | "wallet" | "apps" | "briefing") => void;
  onLogout: () => void;
}

interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate: string | null;
}

interface WeatherData {
  location: string;
  temperature: number;
  feelsLike: number;
  high: number;
  low: number;
  uvIndex: number;
  condition: string;
  icon: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  allDay: boolean;
}

interface DraftItem {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  draftBody: string;
  status: string;
  createdAt: string;
}

interface DashboardData {
  greeting: string;
  name: string;
  sidekickName: string;
  initial: string;
  tasks: TaskItem[];
  walletBalance: number | null;
  calendarConnected: boolean;
  emailConnected: boolean;
}

export default function Dashboard({ state, onNavigate, onLogout }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [scanPhase, setScanPhase] = useState(0);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});

    fetch("/api/weather")
      .then((r) => r.json())
      .then((w) => {
        if (!w.error) setWeather(w);
      })
      .catch(() => {});

    fetch("/api/calendar")
      .then((r) => r.json())
      .then((c) => {
        if (c.events) setCalendarEvents(c.events);
      })
      .catch(() => {});

    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d) => {
        if (d.drafts) setDrafts(d.drafts);
      })
      .catch(() => {});

    // Auto-scan for new drafts in the background
    fetch("/api/drafts/generate", { method: "POST" })
      .then((r) => r.json())
      .then((result) => {
        if (result.drafts?.length > 0) {
          setDrafts((prev) => [...result.drafts, ...prev]);
        }
      })
      .catch(() => {});
  }, []);

  const toggleTask = useCallback(async (id: string, completed: boolean) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === id ? { ...t, completed } : t
        ),
      };
    });

    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, completed }),
    });
  }, []);

  const addTask = useCallback(async () => {
    if (!newTask.trim()) return;
    setAddingTask(true);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTask.trim() }),
      });
      const { task } = await res.json();
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, tasks: [task, ...prev.tasks] };
      });
      setNewTask("");
    } catch {}
    setAddingTask(false);
  }, [newTask]);

  const deleteTask = useCallback(async (id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, tasks: prev.tasks.filter((t) => t.id !== id) };
    });

    await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }, []);

  const generateDrafts = useCallback(async () => {
    setGeneratingDrafts(true);
    setScanPhase(0);
    const phaseTimer = setInterval(() => {
      setScanPhase((p) => (p < 3 ? p + 1 : p));
    }, 2500);
    try {
      const res = await fetch("/api/drafts/generate", { method: "POST" });
      const result = await res.json();
      if (result.drafts?.length > 0) {
        setDrafts((prev) => [...result.drafts, ...prev]);
      }
    } catch {}
    clearInterval(phaseTimer);
    setGeneratingDrafts(false);
    setScanPhase(0);
  }, []);

  const handleDraft = useCallback(async (id: string, status: "approved" | "dismissed") => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    await fetch("/api/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
  const name = data?.name || state.name || "there";
  const initial = data?.initial || (name[0] || "U").toUpperCase();

  const incompleteTasks = data?.tasks.filter((t) => !t.completed) || [];
  const completedTasks = data?.tasks.filter((t) => t.completed) || [];

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {/* Greeting */}
        <div className="flex justify-between items-center pt-6 pb-5 animate-fade-up gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] text-text-secondary">{greeting}</div>
            <div className="text-[28px] font-extrabold tracking-tight text-text-primary truncate">
              {name}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Log out"
            className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-white font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
          >
            {initial}
          </button>
        </div>

        {/* Weather — real data from Open-Meteo */}
        {weather ? (
          <div className="flex items-center gap-3 bg-white rounded-2xl p-4 mb-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <div className="text-3xl">{weather.icon}</div>
            <div className="flex-1">
              <div className="text-text-primary font-semibold text-[15px]">
                {weather.temperature}°F · {weather.condition}
              </div>
              <div className="text-text-muted text-xs">
                High {weather.high}° · Low {weather.low}° · Feels like {weather.feelsLike}°
                {weather.uvIndex >= 6 && " · UV high — wear sunscreen"}
              </div>
            </div>
            <div className="text-text-muted text-[11px] text-right leading-tight">
              {weather.location}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-white rounded-2xl p-4 mb-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <div className="text-3xl">🌡️</div>
            <div className="text-text-muted text-sm">Loading weather...</div>
          </div>
        )}

        {/* Today's Brief */}
        <div className="bg-gradient-to-br from-[#2C2C2C] to-[#1A1A1A] rounded-[18px] p-5 mb-4 text-white animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#86868b] text-[11px] font-semibold uppercase tracking-widest">
              Today&apos;s brief
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#86868b]">
              <span className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-[15px] text-[#e5e5e5] leading-relaxed mb-3.5">
            {incompleteTasks.length > 0 ? (
              <>You have <strong className="text-white">{incompleteTasks.length} task{incompleteTasks.length !== 1 ? "s" : ""}</strong> to tackle today.</>
            ) : (
              <>Your slate is clean — no open tasks.</>
            )}
            {weather && (
              <> It&apos;s <strong className="text-white">{weather.temperature}° and {weather.condition.toLowerCase()}</strong>.</>
            )}
            {drafts.length > 0 && (
              <> You have <strong className="text-white">{drafts.length} draft{drafts.length !== 1 ? " replies" : " reply"}</strong> ready to review.</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onNavigate("chat")}
              className="text-xs font-medium text-white bg-white/10 border border-white/15 rounded-full px-3.5 py-2 hover:bg-white/20 transition-colors"
            >
              💬 Chat with {data?.sidekickName || state.sidekickName || "Sidekick"}
            </button>
          </div>
        </div>

        {/* Today's Schedule — shown when Google Calendar is connected */}
        {data?.calendarConnected && calendarEvents.length > 0 && (
          <Section title="📅 Today's Schedule" delay="0.15s">
            <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-[#f0ede8]">
              {calendarEvents.map((event) => {
                const startTime = event.allDay
                  ? "All day"
                  : new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                const endTime = event.allDay
                  ? ""
                  : new Date(event.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                return (
                  <div key={event.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-1 h-8 rounded-full bg-lime shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-text-primary truncate">{event.title}</div>
                      <div className="text-xs text-text-muted">
                        {startTime}{endTime ? `–${endTime}` : ""}
                        {event.location && ` · ${event.location}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Email Drafts — auto-generated replies */}
        {data?.emailConnected && (
          <Section title="✉️ Draft Replies" delay="0.18s">
            <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0ede8]">
                <span className="text-xs text-text-muted">
                  {drafts.length > 0
                    ? `${drafts.length} draft${drafts.length !== 1 ? "s" : ""} ready to review`
                    : "No pending drafts"}
                </span>
                <button
                  onClick={generateDrafts}
                  disabled={generatingDrafts}
                  className="text-xs font-semibold text-white bg-accent rounded-lg px-3 py-1.5 disabled:opacity-50 transition-opacity"
                >
                  {generatingDrafts ? "Scanning..." : "Scan & Draft"}
                </button>
              </div>
              {generatingDrafts ? (
                <div className="px-4 py-5">
                  <div className="flex flex-col gap-3">
                    {[
                      "Reading your inbox...",
                      "Filtering out noise...",
                      "Finding emails that need replies...",
                      "Drafting responses in your voice...",
                    ].map((label, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className="w-5 h-5 flex items-center justify-center shrink-0">
                          {scanPhase > i ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-fade-up">
                              <circle cx="8" cy="8" r="8" fill="#34C759" />
                              <path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : scanPhase === i ? (
                            <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-[#e0e0e0]" />
                          )}
                        </div>
                        <span className={`text-sm transition-colors duration-300 ${
                          scanPhase > i ? "text-text-muted" : scanPhase === i ? "text-text-primary font-medium" : "text-text-muted/50"
                        }`}>
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 h-1 bg-[#f0f0f0] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(((scanPhase + 1) / 4) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ) : drafts.length > 0 ? (
                <div className="divide-y divide-[#f0ede8]">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="px-4 py-3">
                      <button
                        onClick={() => setExpandedDraft(expandedDraft === draft.id ? null : draft.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                          <span className="text-sm font-semibold text-text-primary truncate flex-1">
                            {draft.subject}
                          </span>
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 ml-4">
                          from {draft.from}
                        </div>
                      </button>
                      {expandedDraft === draft.id && (
                        <div className="mt-3 ml-4">
                          <div className="text-xs text-text-muted mb-1 uppercase tracking-wider font-semibold">
                            Their message
                          </div>
                          <div className="text-xs text-text-secondary bg-bg-secondary rounded-lg p-3 mb-3">
                            {draft.snippet}
                          </div>
                          <div className="text-xs text-text-muted mb-1 uppercase tracking-wider font-semibold">
                            Your draft reply
                          </div>
                          <div className="text-sm text-text-primary bg-lime/10 rounded-lg p-3 mb-3 whitespace-pre-wrap">
                            {draft.draftBody}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDraft(draft.id, "approved")}
                              className="flex-1 text-xs font-semibold text-white bg-accent rounded-lg py-2 hover:bg-accent/90 transition-colors"
                            >
                              ✓ Send It
                            </button>
                            <button
                              onClick={() => handleDraft(draft.id, "dismissed")}
                              className="flex-1 text-xs font-semibold text-text-muted bg-bg-secondary rounded-lg py-2 hover:bg-bg-input transition-colors"
                            >
                              ✕ Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-5 text-center text-text-muted text-sm">
                  All caught up — no new emails to draft.
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Connect Google — handles both calendar and email */}
        {!data?.calendarConnected && (
          <button
            onClick={() => { window.location.href = "/api/integrations/google/connect"; }}
            className="w-full text-left bg-white border border-border border-dashed rounded-2xl p-5 mb-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-fade-up hover:border-accent/30 transition-colors cursor-pointer"
            style={{ animationDelay: "0.15s" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center text-xl">
                🔗
              </div>
              <div className="flex-1">
                <div className="text-text-primary text-sm font-semibold">Connect Google</div>
                <div className="text-text-muted text-xs mt-0.5">
                  Calendar, email, and contacts — Luna sees your full picture.
                </div>
              </div>
              <span className="text-xs font-semibold text-info">
                Connect
              </span>
            </div>
          </button>
        )}

        {/* Action Items — persistent, from database */}
        <Section title="⚡ Action Items" delay="0.25s">
          <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            {/* Add task input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ede8]">
              <input
                type="text"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                placeholder="Add a task..."
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted text-sm focus:outline-none"
              />
              <button
                onClick={addTask}
                disabled={!newTask.trim() || addingTask}
                className="text-xs font-semibold text-white bg-accent rounded-lg px-3 py-1.5 disabled:opacity-30 transition-opacity"
              >
                Add
              </button>
            </div>

            {incompleteTasks.length === 0 && completedTasks.length === 0 ? (
              <div className="px-4 py-6 text-center text-text-muted text-sm">
                No tasks yet. Add one above to get started.
              </div>
            ) : (
              <div className="divide-y divide-[#f0ede8]">
                {incompleteTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={toggleTask}
                    onDelete={deleteTask}
                  />
                ))}
                {completedTasks.length > 0 && (
                  <>
                    {incompleteTasks.length > 0 && (
                      <div className="px-4 py-2 bg-bg-secondary/50">
                        <span className="text-text-muted text-[11px] font-semibold uppercase tracking-wider">
                          Completed ({completedTasks.length})
                        </span>
                      </div>
                    )}
                    {completedTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={toggleTask}
                        onDelete={deleteTask}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* Quick Actions */}
        <Section title="Quick Actions" delay="0.3s">
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { icon: "💬", label: "Chat", tab: "chat" as const },
              { icon: "✅", label: "Add task", focus: true },
              { icon: "💳", label: "Wallet", tab: "wallet" as const },
              { icon: "☀️", label: "Weather", tab: "chat" as const },
            ].map((q) => (
              <button
                key={q.label}
                onClick={() => {
                  if (q.focus) {
                    document.querySelector<HTMLInputElement>('input[placeholder="Add a task..."]')?.focus();
                  } else {
                    onNavigate(q.tab!);
                  }
                }}
                className="flex flex-col items-center gap-1.5 bg-white border border-[#e5e5e5] rounded-2xl py-3.5 px-2 hover:border-[#d1d1d6] transition-colors"
              >
                <span className="text-xl">{q.icon}</span>
                <span className="text-text-primary text-xs font-semibold">{q.label}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* Wallet Preview */}
        {data?.walletBalance !== null && data?.walletBalance !== undefined && (
          <Section title="💳 Wallet" delay="0.35s">
            <button
              onClick={() => onNavigate("wallet")}
              className="w-full text-left bg-gradient-to-br from-[#2C2C2C] to-[#1A1A1A] rounded-2xl p-5 text-white hover:from-[#333] hover:to-[#222] transition-colors"
            >
              <div className="text-xs font-bold tracking-widest text-[#86868b] mb-3">
                SIDEKICK <span className="text-[#86868b]/50">WALLET</span>
              </div>
              <div className="text-4xl font-bold mb-1">
                ${data.walletBalance.toFixed(2)}
              </div>
              <div className="text-[11px] text-[#86868b] uppercase tracking-wider">
                available balance
              </div>
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: TaskItem;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 group">
      <button
        onClick={() => onToggle(task.id, !task.completed)}
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
          task.completed
            ? "bg-accent border-accent text-white"
            : "border-[#d1d1d6] hover:border-accent/40"
        }`}
      >
        {task.completed && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span
        className={`flex-1 text-sm transition-colors ${
          task.completed ? "text-text-muted line-through" : "text-text-primary"
        }`}
      >
        {task.title}
      </span>
      <button
        onClick={() => onDelete(task.id)}
        className="text-text-muted hover:text-danger text-xs opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </div>
  );
}

function Section({
  title,
  delay,
  children,
}: {
  title: string;
  delay: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 animate-fade-up" style={{ animationDelay: delay }}>
      <div className="text-text-primary text-[15px] font-bold mb-2.5">{title}</div>
      {children}
    </div>
  );
}
