"use client";

import { useState, useEffect, useCallback } from "react";
import { SidekickState, loadState, saveState } from "@/lib/store";
import AuthScreen from "./components/AuthScreen";
import Onboarding from "./components/Onboarding";
import Dashboard from "./components/Dashboard";
import Chat from "./components/Chat";
import Wallet from "./components/Wallet";
import ConnectedApps from "./components/ConnectedApps";
import MorningBriefing from "./components/MorningBriefing";

type Tab = "home" | "chat" | "wallet" | "apps" | "briefing";
type AuthUser = { id: string; email: string; name: string | null; onboarded: boolean; sidekickName: string } | null;

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | "loading">("loading");
  const [state, setState] = useState<SidekickState | null>(null);
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setAuthUser(data.user);
          fetch("/api/onboarding")
            .then((r) => r.json())
            .then((profile) => setState(profile))
            .catch(() => setState(loadState()));
        } else {
          setAuthUser(null);
          setState(loadState());
        }
      })
      .catch(() => {
        setAuthUser(null);
        setState(loadState());
      });
  }, []);

  const handleUpdate = useCallback((partial: Partial<SidekickState>) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      saveState(next);
      if (authUser && authUser !== "loading") {
        fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        }).catch(() => {});
      }
      return next;
    });
  }, [authUser]);

  const handleOnboardingComplete = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, onboarded: true };
      saveState(next);
      if (authUser && authUser !== "loading") {
        fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboarded: true }),
        }).catch(() => {});
      }
      return next;
    });
  }, [authUser]);

  if (authUser === "loading" || !state) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-text-primary text-3xl font-bold tracking-tight animate-pulse">
          Sidekick
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="h-screen max-w-lg mx-auto">
        <AuthScreen
          onAuth={(user) => {
            setAuthUser(user);
            if (user.onboarded) {
              fetch("/api/onboarding")
                .then((r) => r.json())
                .then((profile) => setState(profile))
                .catch(() => {});
            }
          }}
        />
      </div>
    );
  }

  if (!state.onboarded) {
    return (
      <div className="h-screen max-w-lg mx-auto">
        <Onboarding
          state={state}
          onUpdate={handleUpdate}
          onComplete={handleOnboardingComplete}
        />
      </div>
    );
  }

  return (
    <div className="h-screen max-w-lg mx-auto flex flex-col relative bg-bg-secondary">
      <div className="flex-1 overflow-hidden">
        {tab === "home" && <Dashboard state={state} onNavigate={setTab} />}
        {tab === "chat" && <Chat state={state} />}
        {tab === "wallet" && <Wallet />}
        {tab === "apps" && <ConnectedApps />}
        {tab === "briefing" && <MorningBriefing />}
      </div>

      <div className="flex border-t border-border bg-white">
        <TabButton icon="🏠" label="home" active={tab === "home"} onClick={() => setTab("home")} />
        <TabButton icon="💬" label="chat" active={tab === "chat"} onClick={() => setTab("chat")} />
        <TabButton icon="💳" label="wallet" active={tab === "wallet"} onClick={() => setTab("wallet")} />
        <TabButton icon="🔗" label="apps" active={tab === "apps"} onClick={() => setTab("apps")} />
        <TabButton icon="☀️" label="briefing" active={tab === "briefing"} onClick={() => setTab("briefing")} />
      </div>
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${
        active ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className={`text-[10px] font-semibold ${active ? "text-text-primary" : ""}`}>{label}</span>
    </button>
  );
}
