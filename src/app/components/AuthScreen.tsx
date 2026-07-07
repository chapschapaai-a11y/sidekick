"use client";

import { useState } from "react";

interface Props {
  onAuth: (user: { id: string; email: string; name: string | null; onboarded: boolean; sidekickName: string }) => void;
}

export default function AuthScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = mode === "signup"
        ? { email, password, name }
        : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      onAuth(data.user);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="w-16 h-16 mb-6">
          <svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg">
            <path d="M52 6c14 0 22 10 22 22s-8 20-22 22C36 52 26 54 22 66c-2 6 0 14 6 18 6 5 14 6 20 4-8 8-22 10-32 2S4 72 10 60c6-14 22-18 36-22 8-2 14-8 14-16S54 8 44 10c4-2 6-4 8-4z" fill="#b8e600"/>
            <path d="M28 94c-14 0-22-10-22-22s8-20 22-22c16-2 26-4 30-16 2-6 0-14-6-18-6-5-14-6-20-4 8-8 22-10 32-2s12 18 6 30c-6 14-22 18-36 22-8 2-14 8-14 16s6 14 16 12c-4 2-6 4-8 4z" fill="#b8e600"/>
          </svg>
        </div>
        <h1 className="font-display text-[40px] text-text-primary mb-1">Sidekick</h1>
        <p className="text-text-secondary text-sm mb-8">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </p>

        <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-3">
          {mode === "signup" && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full border-2 border-border focus:border-lime rounded-2xl px-4 py-3.5 text-[15px] text-text-primary bg-white placeholder:text-text-muted outline-none transition-colors"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full border-2 border-border focus:border-lime rounded-2xl px-4 py-3.5 text-[15px] text-text-primary bg-white placeholder:text-text-muted outline-none transition-colors"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ characters)"
            required
            minLength={6}
            className="w-full border-2 border-border focus:border-lime rounded-2xl px-4 py-3.5 text-[15px] text-text-primary bg-white placeholder:text-text-muted outline-none transition-colors"
          />

          {error && (
            <p className="text-danger text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-white font-semibold py-4 rounded-full text-[17px] tracking-tight hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-50 shadow-[0_4px_16px_rgba(26,26,26,0.18)]"
          >
            {loading ? "..." : mode === "signup" ? "Create Account" : "Log In"}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}
          className="mt-6 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          {mode === "signup" ? "Already have an account? Log in" : "Need an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
