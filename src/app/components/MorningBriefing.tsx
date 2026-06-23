"use client";

import { useState, useEffect, useCallback } from "react";

interface BriefingSettings {
  enabled: boolean;
  phone: string;
  wakeTime: string;
  timezone: string;
}

export default function MorningBriefing() {
  const [settings, setSettings] = useState<BriefingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/morning-briefing");
      if (!res.ok) {
        setFetchError(`API returned ${res.status}`);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSettings(data);
      setPhone(data.phone || "");
      setWakeTime(data.wakeTime || "07:00");
    } catch (e) {
      setFetchError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleToggle() {
    if (!settings) return;
    const newEnabled = !settings.enabled;

    if (newEnabled && !phone) {
      setTestResult("Add your phone number first");
      return;
    }

    setSaving(true);
    try {
      await fetch("/api/settings/morning-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled, phone, wakeTime }),
      });
      setSettings({ ...settings, enabled: newEnabled, phone, wakeTime });
      setTestResult(null);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/settings/morning-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, wakeTime }),
      });
      setSettings((prev) => prev ? { ...prev, phone, wakeTime } : prev);
      setTestResult("Settings saved");
      setTimeout(() => setTestResult(null), 2000);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function handleTestBriefing() {
    if (!phone) {
      setTestResult("Add your phone number first");
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/morning-briefing", { method: "POST" });
      const data = await res.json();
      if (data.sent) {
        setTestResult("Briefing sent! Check your phone");
      } else if (data.message) {
        setTestResult(data.error || "Generated but couldn't send — check Twilio setup");
      } else {
        setTestResult(data.error || "Something went wrong");
      }
    } catch {
      setTestResult("Failed to generate briefing");
    }
    setTestSending(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-5">
        <div className="text-red-500 text-sm text-center">{fetchError}</div>
        <button onClick={() => { setLoading(true); setFetchError(null); fetchSettings(); }} className="text-sm font-semibold text-white bg-[#1a1a1a] px-4 py-2 rounded-xl">
          Retry
        </button>
      </div>
    );
  }

  const formatTimeLabel = (time: unknown) => {
    if (!time || typeof time !== "string" || !time.includes(":")) return "7:00 AM";
    const parts = time.split(":");
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-5 pt-6 pb-3">
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Morning Briefing</h2>
        <p className="text-sm text-text-muted mt-1">
          Get a daily text from Luna with your schedule, weather, and proactive suggestions
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {/* Toggle */}
        <div className="flex items-center justify-between p-4 mt-2 rounded-2xl border border-[#e8e8ea] bg-white">
          <div>
            <h3 className="font-semibold text-text-primary text-[15px]">Daily Briefing</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {settings?.enabled ? `Active — sends at ${formatTimeLabel(wakeTime)}` : "Currently off"}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={saving}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings?.enabled ? "bg-[#1a1a1a]" : "bg-[#e0e0e0]"
            }`}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                settings?.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Phone Number */}
        <div className="mt-3 p-4 rounded-2xl border border-[#e8e8ea] bg-white">
          <label className="block font-semibold text-text-primary text-[15px] mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 (555) 555-5555"
            className="w-full px-3 py-2.5 rounded-xl border border-[#e0e0e0] text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#1a1a1a] transition-colors"
          />
          <p className="text-[11px] text-text-muted mt-1.5">
            Include country code (e.g. +1 for US)
          </p>
        </div>

        {/* Wake Time */}
        <div className="mt-3 p-4 rounded-2xl border border-[#e8e8ea] bg-white">
          <label className="block font-semibold text-text-primary text-[15px] mb-2">
            Briefing Time
          </label>
          <input
            type="time"
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[#e0e0e0] text-sm text-text-primary focus:outline-none focus:border-[#1a1a1a] transition-colors"
          />
          <p className="text-[11px] text-text-muted mt-1.5">
            Luna will text you around this time every morning
          </p>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-4 bg-[#1a1a1a] text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50 transition-opacity"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {/* Test */}
        <button
          onClick={handleTestBriefing}
          disabled={testSending}
          className="w-full mt-3 bg-white text-text-primary font-semibold py-3 rounded-2xl text-sm border border-[#e0e0e0] disabled:opacity-50 transition-opacity"
        >
          {testSending ? "Generating briefing..." : "Send Test Briefing Now"}
        </button>

        {testResult && (
          <div className={`mt-3 p-3 rounded-xl text-sm text-center ${
            testResult.includes("sent") || testResult.includes("saved")
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}>
            {testResult}
          </div>
        )}

        {/* Preview */}
        <div className="mt-6 p-4 bg-bg-secondary rounded-2xl">
          <p className="text-xs text-text-muted leading-relaxed">
            <strong className="text-text-primary">What you&apos;ll get:</strong> A text from Luna
            covering your weather, calendar, tasks, and wallet — plus proactive suggestions like
            scheduling rides, ordering dinner, or placing grocery orders based on what&apos;s on your
            list and connected apps.
          </p>
        </div>
      </div>
    </div>
  );
}
