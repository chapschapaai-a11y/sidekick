"use client";

import { useState } from "react";

interface Props {
  onComplete: () => void;
  onClose: () => void;
}

const PROVIDERS = [
  {
    id: "icloud",
    name: "Apple Calendar",
    icon: "🍎",
    color: "#333",
    steps: [
      { title: "Open iCloud Calendar", instruction: "Go to **icloud.com/calendar** in your browser and sign in with your Apple ID." },
      { title: "Find your calendar", instruction: "In the left sidebar, find the calendar you want to share (e.g. \"Personal\" or \"Work\")." },
      { title: "Share it", instruction: "Click the **share icon** (person with a +) next to the calendar name. Check **\"Public Calendar\"**." },
      { title: "Copy the URL", instruction: "A link will appear starting with `webcal://`. **Copy that link** and paste it below." },
    ],
  },
  {
    id: "google",
    name: "Google Calendar",
    icon: "📅",
    color: "#4285F4",
    steps: [
      { title: "Open Google Calendar settings", instruction: "Go to **calendar.google.com**, click the **gear icon** (top right), then **Settings**." },
      { title: "Find your calendar", instruction: "In the left sidebar under \"Settings for my calendars\", click the calendar you want to add." },
      { title: "Get the secret address", instruction: "Scroll down to **\"Secret address in iCal format\"**. If you don't see it, click \"Integrate calendar\" first." },
      { title: "Copy the URL", instruction: "Click **\"Copy\"** next to the URL. It starts with `https://calendar.google.com/calendar/ical/...`. Paste it below." },
    ],
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    icon: "📧",
    color: "#0078D4",
    steps: [
      { title: "Open Outlook Calendar", instruction: "Go to **outlook.com** or **outlook.office.com** and open your **Calendar**." },
      { title: "Open sharing settings", instruction: "Click the **gear icon** → **View all Outlook settings** → **Calendar** → **Shared calendars**." },
      { title: "Publish your calendar", instruction: "Under **\"Publish a calendar\"**, select the calendar and permissions, then click **Publish**." },
      { title: "Copy the ICS link", instruction: "Two links will appear. Copy the one labeled **\"ICS\"** (not HTML). Paste it below." },
    ],
  },
  {
    id: "yahoo",
    name: "Yahoo Calendar",
    icon: "📆",
    color: "#6001D2",
    steps: [
      { title: "Open Yahoo Calendar", instruction: "Go to **calendar.yahoo.com** and sign in." },
      { title: "Open calendar settings", instruction: "Hover over the calendar name in the left sidebar, click the **three dots** (⋯), then **\"Share this Calendar\"**." },
      { title: "Get the subscription URL", instruction: "Toggle on **\"Share with link\"** and copy the URL that appears." },
      { title: "Paste it below", instruction: "Paste the URL in the field below. It should start with `webcal://` or `https://`." },
    ],
  },
  {
    id: "other",
    name: "Other Calendar",
    icon: "📋",
    color: "#666",
    steps: [
      { title: "Find your calendar's sharing settings", instruction: "Most calendar apps have a **Share** or **Publish** option. Look in your calendar's settings." },
      { title: "Get the subscription URL", instruction: "Look for an option that says **\"Subscribe\"**, **\"ICS\"**, **\"iCal\"**, or **\"Public URL\"**. Copy that link." },
      { title: "Paste it below", instruction: "The URL usually starts with `webcal://` or `https://` and ends in `.ics`. Paste it below." },
    ],
  },
];

export default function CalendarImportWizard({ onComplete, onClose }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [calendarName, setCalendarName] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider);

  async function handleSave() {
    if (!calendarUrl.trim() || !calendarName.trim()) {
      setError("Give your calendar a name and paste the URL");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/calendar-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: calendarName.trim(),
          url: calendarUrl.trim().replace(/^webcal:\/\//, "https://"),
          provider: selectedProvider,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setSaving(false);
        return;
      }

      onComplete();
    } catch {
      setError("Couldn't save — check your connection");
      setSaving(false);
    }
  }

  // Step 1: Pick your calendar app
  if (!selectedProvider) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f0f0]">
          <button onClick={onClose} className="text-text-muted text-sm">← Back</button>
          <h2 className="text-lg font-bold text-text-primary flex-1">Import Calendar</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <p className="text-sm text-text-muted mb-5">
            Which calendar app do you use? We&apos;ll walk you through it step by step.
          </p>

          <div className="flex flex-col gap-3">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className="flex items-center gap-3 p-4 rounded-2xl border border-[#e8e8ea] bg-white text-left active:scale-[0.98] transition-transform"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${p.color}15` }}
                >
                  {p.icon}
                </div>
                <div>
                  <div className="font-semibold text-text-primary text-[15px]">{p.name}</div>
                  <div className="text-xs text-text-muted">Tap to start</div>
                </div>
                <div className="ml-auto text-text-muted">→</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!provider) return null;

  const isLastStep = currentStep >= provider.steps.length;

  // Step 2+: Walk through the instructions
  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f0f0]">
        <button
          onClick={() => {
            if (currentStep === 0) {
              setSelectedProvider(null);
            } else {
              setCurrentStep(currentStep - 1);
            }
          }}
          className="text-text-muted text-sm"
        >
          ← Back
        </button>
        <h2 className="text-lg font-bold text-text-primary flex-1">{provider.name}</h2>
        <span className="text-xs text-text-muted">
          {isLastStep ? "Almost done" : `Step ${currentStep + 1} of ${provider.steps.length}`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        {!isLastStep ? (
          <>
            {/* Progress dots */}
            <div className="flex gap-1.5 mb-6">
              {provider.steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= currentStep ? "bg-[#1a1a1a]" : "bg-[#e0e0e0]"
                  }`}
                />
              ))}
              <div className={`h-1 flex-1 rounded-full bg-[#e0e0e0]`} />
            </div>

            {/* Step number badge */}
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-white mb-4"
              style={{ backgroundColor: provider.color }}
            >
              Step {currentStep + 1}
            </div>

            {/* Step title */}
            <h3 className="text-xl font-bold text-text-primary mb-3">
              {provider.steps[currentStep].title}
            </h3>

            {/* Step instruction */}
            <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {provider.steps[currentStep].instruction.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, i) => {
                if (part.startsWith("**") && part.endsWith("**")) {
                  return <strong key={i} className="text-text-primary font-semibold">{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith("`") && part.endsWith("`")) {
                  return <code key={i} className="text-xs bg-[#f0f0f0] px-1.5 py-0.5 rounded font-mono">{part.slice(1, -1)}</code>;
                }
                return <span key={i}>{part}</span>;
              })}
            </div>
          </>
        ) : (
          <>
            {/* Final step: paste URL */}
            <div className="flex gap-1.5 mb-6">
              {provider.steps.map((_, i) => (
                <div key={i} className="h-1 flex-1 rounded-full bg-[#1a1a1a]" />
              ))}
              <div className="h-1 flex-1 rounded-full bg-[#1a1a1a]" />
            </div>

            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-white mb-4"
              style={{ backgroundColor: provider.color }}
            >
              Final Step
            </div>

            <h3 className="text-xl font-bold text-text-primary mb-3">
              Paste your calendar link
            </h3>

            <p className="text-sm text-text-muted mb-5">
              Give this calendar a name and paste the URL you copied.
            </p>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1.5">
                  Calendar name
                </label>
                <input
                  type="text"
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  placeholder="e.g. Work, Personal, Family"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e0e0e0] text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#1a1a1a] transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1.5">
                  Calendar URL
                </label>
                <input
                  type="url"
                  value={calendarUrl}
                  onChange={(e) => setCalendarUrl(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/..."
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e0e0e0] text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#1a1a1a] transition-colors font-mono text-xs"
                />
                <p className="text-[11px] text-text-muted mt-1.5">
                  Starts with https:// or webcal:// — usually ends in .ics
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm text-center">
                  {error}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom button */}
      <div className="px-5 py-4 border-t border-[#f0f0f0]">
        {!isLastStep ? (
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            className="w-full bg-[#1a1a1a] text-white font-semibold py-3.5 rounded-2xl text-base active:scale-[0.98] transition-transform"
          >
            {currentStep === provider.steps.length - 1 ? "I copied the link →" : "Next →"}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving || !calendarUrl.trim() || !calendarName.trim()}
            className="w-full bg-[#1a1a1a] text-white font-semibold py-3.5 rounded-2xl text-base disabled:opacity-50 transition-opacity active:scale-[0.98]"
          >
            {saving ? "Connecting..." : "Connect Calendar"}
          </button>
        )}
      </div>
    </div>
  );
}
