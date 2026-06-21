"use client";

export interface SidekickState {
  name: string;
  email: string;
  phone: string;
  age: number;
  backgrounds: string[];
  formality: number;
  humor: number;
  directness: number;
  energy: number;
  detail: number;
  needs: string[];
  wakeTime: string;
  commute: string[];
  diet: string[];
  location: string;
  latitude: number | null;
  longitude: number | null;
  sidekickName: string;
  morningBriefing: boolean;
  onboarded: boolean;
}

const DEFAULT_STATE: SidekickState = {
  name: "",
  email: "",
  phone: "",
  age: 28,
  backgrounds: [],
  formality: 25,
  humor: 30,
  directness: 70,
  energy: 60,
  detail: 35,
  needs: [],
  wakeTime: "",
  commute: [],
  diet: [],
  location: "",
  latitude: null,
  longitude: null,
  sidekickName: "",
  morningBriefing: false,
  onboarded: false,
};

export function loadState(): SidekickState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const saved = localStorage.getItem("sidekick_state");
  if (!saved) return DEFAULT_STATE;
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(saved) };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state: SidekickState) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sidekick_state", JSON.stringify(state));
}

export function resetState() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("sidekick_state");
}
