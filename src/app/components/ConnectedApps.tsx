"use client";

import { useState, useEffect, useCallback } from "react";

interface AppConnection {
  provider: string;
  status: "connected" | "disconnected" | "connecting";
  connectedAt?: string;
}

const OAUTH_APPS = [
  {
    id: "google",
    name: "Google",
    icon: "📧",
    description: "Gmail & Calendar — read, send, and schedule",
    color: "#4285F4",
    connectUrl: "/api/integrations/google/connect",
  },
];

const APPS = [
  {
    id: "ubereats",
    name: "Uber Eats",
    icon: "🍔",
    description: "Order food from any restaurant",
    loginUrl: "https://auth.uber.com/v2/",
    color: "#06C167",
  },
  {
    id: "doordash",
    name: "DoorDash",
    icon: "🚗",
    description: "Food delivery from local spots",
    loginUrl: "https://identity.doordash.com/auth/user/login",
    color: "#FF3008",
  },
  {
    id: "lyft",
    name: "Lyft",
    icon: "🚘",
    description: "Get rides anywhere",
    loginUrl: "https://www.lyft.com/login",
    color: "#FF00BF",
  },
  {
    id: "amazon",
    name: "Amazon",
    icon: "📦",
    description: "Shop for anything, delivered fast",
    loginUrl: "https://www.amazon.com/ap/signin",
    color: "#FF9900",
  },
];

export default function ConnectedApps() {
  const [connections, setConnections] = useState<Record<string, AppConnection>>({});
  const [oauthConnections, setOauthConnections] = useState<Record<string, AppConnection>>({});
  const [loading, setLoading] = useState(true);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const [browserRes, oauthRes] = await Promise.all([
        fetch("/api/connections"),
        fetch("/api/integrations/status"),
      ]);
      const browserData = await browserRes.json();
      const oauthData = await oauthRes.json();
      const map: Record<string, AppConnection> = {};
      for (const c of browserData.connections || []) {
        map[c.provider] = { provider: c.provider, status: "connected", connectedAt: c.connectedAt };
      }
      setConnections(map);
      const oauthMap: Record<string, AppConnection> = {};
      for (const c of oauthData.connections || []) {
        oauthMap[c.provider] = { provider: c.provider, status: "connected", connectedAt: c.connectedAt };
      }
      setOauthConnections(oauthMap);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConnections();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "google") {
      window.history.replaceState({}, "", "/");
    }
  }, [fetchConnections]);

  async function handleConnect(appId: string) {
    setConnectingApp(appId);
    try {
      const res = await fetch("/api/connections/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: appId }),
      });
      const data = await res.json();
      if (data.liveUrl) {
        setSessionUrl(data.liveUrl);
      }
    } catch {
      setConnectingApp(null);
    }
  }

  async function handleDoneConnecting() {
    if (!connectingApp) return;
    try {
      await fetch("/api/connections/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: connectingApp }),
      });
      setConnections((prev) => ({
        ...prev,
        [connectingApp]: { provider: connectingApp, status: "connected", connectedAt: new Date().toISOString() },
      }));
    } catch {
      // ignore
    }
    setConnectingApp(null);
    setSessionUrl(null);
  }

  async function handleDisconnect(appId: string) {
    try {
      await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: appId }),
      });
      setConnections((prev) => {
        const next = { ...prev };
        delete next[appId];
        return next;
      });
    } catch {
      // ignore
    }
  }

  if (connectingApp && sessionUrl) {
    const app = APPS.find((a) => a.id === connectingApp);
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#f0f0f0]">
          <button
            onClick={() => { setConnectingApp(null); setSessionUrl(null); }}
            className="text-text-muted text-sm"
          >
            ← Back
          </button>
          <h3 className="text-text-primary font-semibold text-base flex-1">
            Log in to {app?.name}
          </h3>
        </div>

        <div className="flex-1 flex flex-col">
          <iframe
            src={sessionUrl}
            className="flex-1 w-full border-0"
            allow="clipboard-write"
          />
        </div>

        <div className="px-5 py-4 border-t border-[#f0f0f0]">
          <button
            onClick={handleDoneConnecting}
            className="w-full bg-[#1a1a1a] text-white font-semibold py-3.5 rounded-2xl text-base"
          >
            I&apos;m logged in — save connection
          </button>
          <p className="text-xs text-text-muted text-center mt-2">
            Log in above, then tap this button to save your session
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-5 pt-6 pb-3">
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Connected Apps</h2>
        <p className="text-sm text-text-muted mt-1">
          Link your accounts so Luna can order, book, and shop for you
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col gap-3 mt-2">
          {OAUTH_APPS.map((app) => {
            const conn = oauthConnections[app.id];
            const isConnected = conn?.status === "connected";

            return (
              <div
                key={app.id}
                className="flex items-center gap-3 p-4 rounded-2xl border border-[#e8e8ea] bg-white"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${app.color}15` }}
                >
                  {app.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-[15px]">{app.name}</h3>
                    {isConnected && (
                      <span className="text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">{app.description}</p>
                </div>
                {isConnected ? (
                  <button
                    onClick={async () => {
                      await fetch("/api/integrations/status", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ provider: app.id }),
                      });
                      setOauthConnections((prev) => {
                        const next = { ...prev };
                        delete next[app.id];
                        return next;
                      });
                    }}
                    className="text-xs font-medium text-red-500 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      window.location.href = app.connectUrl;
                    }}
                    className="text-xs font-semibold text-white px-4 py-2 rounded-xl transition-colors"
                    style={{ backgroundColor: app.color }}
                  >
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 mt-3">
          {APPS.map((app) => {
            const conn = connections[app.id];
            const isConnected = conn?.status === "connected";

            return (
              <div
                key={app.id}
                className="flex items-center gap-3 p-4 rounded-2xl border border-[#e8e8ea] bg-white"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${app.color}15` }}
                >
                  {app.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-[15px]">{app.name}</h3>
                    {isConnected && (
                      <span className="text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">{app.description}</p>
                </div>
                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(app.id)}
                    className="text-xs font-medium text-red-500 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(app.id)}
                    disabled={!!connectingApp}
                    className="text-xs font-semibold text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                    style={{ backgroundColor: app.color }}
                  >
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!loading && Object.keys(connections).length > 0 && (
          <div className="mt-6 p-4 bg-bg-secondary rounded-2xl">
            <p className="text-xs text-text-muted leading-relaxed">
              <strong className="text-text-primary">How it works:</strong> When you connect an app,
              Luna can place orders and book rides on your behalf. Just tell her what you need in chat
              — she handles everything. You only approve or decline.
            </p>
          </div>
        )}

        {!loading && Object.keys(connections).length === 0 && Object.keys(oauthConnections).length === 0 && (
          <div className="mt-8 text-center">
            <p className="text-4xl mb-3">🔗</p>
            <p className="text-sm text-text-muted">
              Connect your first app to unlock hands-free ordering
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
