"use client";

import { useState, useCallback } from "react";
import { SidekickState, saveState } from "@/lib/store";

const BACKGROUNDS = [
  { label: "Latino / Hispanic", icon: "🌍" },
  { label: "Black / African American", icon: "🌎" },
  { label: "White / European", icon: "🌏" },
  { label: "Asian / Pacific Islander", icon: "🌈" },
  { label: "Middle Eastern / North African", icon: "☀️" },
  { label: "Mixed / Multiracial", icon: "⚡" },
  { label: "Other / Prefer not to say", icon: "✨" },
];

const NEEDS = [
  { label: "My schedule", icon: "📅", desc: "Calendar, meetings, time blocking" },
  { label: "Food & dinner", icon: "🍽️", desc: "Meal planning, restaurants, groceries" },
  { label: "Texting & communication", icon: "💬", desc: "Draft messages, coordinate with people" },
  { label: "Work & meetings", icon: "💼", desc: "Prep, follow-ups, briefings" },
  { label: "Travel & logistics", icon: "🚗", desc: "Trips, directions, leave-now alerts" },
  { label: "Health & wellness", icon: "💪", desc: "Appointments, reminders, check-ins" },
  { label: "Family coordination", icon: "👪", desc: "Kids' schedules, groceries, household" },
  { label: "Birthdays & gifts", icon: "🎁", desc: "Never forget a date again" },
];

const WAKE_TIMES = [
  { label: "Early", desc: "Before 6:30 AM", val: "early", icon: "🌅" },
  { label: "Normal", desc: "6:30 – 8:30 AM", val: "normal", icon: "☀️" },
  { label: "Late", desc: "After 8:30 AM", val: "late", icon: "🌙" },
];

const COMMUTE_OPTIONS = [
  { label: "I drive", val: "car", icon: "🚗" },
  { label: "Rideshare", val: "rideshare", icon: "🚕" },
  { label: "Public transit", val: "transit", icon: "🚌" },
  { label: "Walk / Bike", val: "walk", icon: "🚶" },
];

const DIET_OPTIONS = [
  "No restrictions",
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Keto / Low-carb",
  "Halal / Kosher",
];

interface Props {
  state: SidekickState;
  onUpdate: (s: Partial<SidekickState>) => void;
  onComplete: () => void;
}

export default function Onboarding({ state, onUpdate, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "granted" | "denied">("idle");

  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        onUpdate({ latitude, longitude });
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=10`
          );
          const data = await res.json();
          const addr = data.address || {};
          const city = addr.city || addr.town || addr.village || addr.county || "";
          const stateStr = addr.state || "";
          const locationStr = [city, stateStr].filter(Boolean).join(", ");
          if (locationStr) {
            onUpdate({ location: locationStr, latitude, longitude });
          }
        } catch {
          onUpdate({ latitude, longitude });
        }
        setLocationStatus("granted");
      },
      () => {
        setLocationStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [onUpdate]);

  function next() {
    if (step < steps.length - 1) setStep(step + 1);
    else finish();
  }

  function back() {
    if (step > 0) setStep(step - 1);
  }

  function finish() {
    const finalState = { ...state, onboarded: true };
    saveState(finalState);
    onComplete();
  }

  function toggle(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  }

  const steps = [
    // 0: Welcome
    <div key="welcome" className="flex flex-col items-center justify-center h-full text-center px-8 animate-fade-up">
      <div className="w-20 h-20 mb-8">
        <svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M52 6c14 0 22 10 22 22s-8 20-22 22C36 52 26 54 22 66c-2 6 0 14 6 18 6 5 14 6 20 4-8 8-22 10-32 2S4 72 10 60c6-14 22-18 36-22 8-2 14-8 14-16S54 8 44 10c4-2 6-4 8-4z" fill="#b8e600"/>
          <path d="M28 94c-14 0-22-10-22-22s8-20 22-22c16-2 26-4 30-16 2-6 0-14-6-18-6-5-14-6-20-4 8-8 22-10 32-2s12 18 6 30c-6 14-22 18-36 22-8 2-14 8-14 16s6 14 16 12c-4 2-6 4-8 4z" fill="#b8e600"/>
        </svg>
      </div>
      <h1 className="text-[42px] font-extrabold tracking-tight text-text-primary mb-3">
        Sidekick
      </h1>
      <p className="text-xl text-text-secondary leading-snug mb-10">
        The AI assistant<br />that actually works.
      </p>
      <button
        onClick={next}
        className="bg-accent text-white font-bold px-12 py-4 rounded-full text-[17px] tracking-tight hover:opacity-90 active:scale-[0.97] transition-all"
      >
        Get Started
      </button>
      <p className="text-xs text-text-muted mt-6">Your AI. Your rules.</p>
    </div>,

    // 1: Name
    <StepWrapper key="name" title="First, what's your name?" hint="Your Sidekick needs to know what to call you." onNext={next} onBack={back} canNext={state.name.length > 0}>
      <input
        type="text"
        value={state.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder="Your first name"
        autoFocus
        className="w-full border-b-2 border-[#e5e5e5] focus:border-accent bg-transparent px-0 py-3 text-xl font-medium text-text-primary placeholder:text-[#d1d1d6] outline-none transition-colors tracking-tight"
      />
    </StepWrapper>,

    // 2: Phone number
    <StepWrapper key="contact" title="What's your phone number?" hint="Your Sidekick uses this to text you briefings, reminders, and updates." onNext={next} onBack={back} canNext={state.phone.length > 6}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[13px] font-semibold text-accent-light mb-1.5">Phone number</div>
          <input
            type="tel"
            value={state.phone}
            onChange={(e) => onUpdate({ phone: e.target.value })}
            placeholder="(512) 555-1234"
            autoFocus
            className="w-full border-b-2 border-[#e5e5e5] focus:border-accent bg-transparent px-0 py-3 text-lg text-text-primary placeholder:text-[#d1d1d6] outline-none transition-colors"
          />
        </div>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={state.smsConsent}
            onChange={(e) => onUpdate({ smsConsent: e.target.checked })}
            className="mt-1 w-4 h-4 accent-accent shrink-0"
          />
          <span className="text-[13px] text-text-muted leading-relaxed">
            <strong>Optional:</strong> I agree to receive recurring automated text messages from
            Sidekick at the number provided (daily briefings, reminders, confirmations, and
            account updates). Consent is not required to use Sidekick or as a condition of any
            purchase — you can skip this and still use the app. Message frequency varies. Message
            &amp; data rates may apply. Reply HELP for help or STOP to cancel anytime.{" "}
            <a href="/sms-consent" target="_blank" className="text-accent underline">SMS Terms</a>
            {" "}&amp;{" "}
            <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>.
          </span>
        </label>
        <Callout icon="🔒">Your number is encrypted and never shared. Your Sidekick uses it to text you morning briefings and handle things on your behalf.</Callout>
      </div>
    </StepWrapper>,

    // 3: Age
    <StepWrapper key="age" title="How old are you?" hint="This helps your Sidekick match your vibe and cultural references." onNext={next} onBack={back} canNext>
      <div className="flex flex-col items-center gap-2">
        <div className="text-[56px] font-extrabold text-text-primary tracking-tight">{state.age}</div>
        <div className="text-[13px] text-text-muted mb-4">
          {state.age < 23 ? "Gen Z energy" : state.age < 30 ? "Late twenties grind" : state.age < 40 ? "Millennial prime" : state.age < 50 ? "Peak experience" : "Wisdom mode"}
        </div>
        <input
          type="range"
          min={16}
          max={80}
          value={state.age}
          onChange={(e) => onUpdate({ age: parseInt(e.target.value) })}
          className="w-full"
        />
        <Callout icon="💡">Your age shapes how your Sidekick communicates — references, humor, pacing.</Callout>
      </div>
    </StepWrapper>,

    // 4: Background
    <StepWrapper key="bg" title="What's your background?" hint="Pick all that apply. This helps your Sidekick understand your cultural context." onNext={next} onBack={back} canNext>
      <div className="flex flex-col gap-2.5">
        {BACKGROUNDS.map((b) => (
          <OptionCard
            key={b.label}
            icon={b.icon}
            title={b.label}
            selected={state.backgrounds.includes(b.label)}
            onClick={() => onUpdate({ backgrounds: toggle(state.backgrounds, b.label) })}
            multi
          />
        ))}
      </div>
    </StepWrapper>,

    // 5: Communication style
    <StepWrapper key="style" title="How should your Sidekick talk to you?" hint="Slide each one to set the vibe." onNext={next} onBack={back} canNext>
      <div className="flex flex-col gap-7">
        <StyleSlider left="Casual" right="Formal" value={state.formality} onChange={(v) => onUpdate({ formality: v })} />
        <StyleSlider left="Funny" right="Serious" value={state.humor} onChange={(v) => onUpdate({ humor: v })} />
        <StyleSlider left="Gentle" right="Direct" value={state.directness} onChange={(v) => onUpdate({ directness: v })} />
        <StyleSlider left="Chill" right="High-energy" value={state.energy} onChange={(v) => onUpdate({ energy: v })} />
        <StyleSlider left="Brief" right="Detailed" value={state.detail} onChange={(v) => onUpdate({ detail: v })} />
        <Callout icon="🎙️">These dials shape every message your Sidekick sends. You can always fine-tune later.</Callout>
      </div>
    </StepWrapper>,

    // 6: Needs
    <StepWrapper key="needs" title="What do you need help with?" hint="Pick everything that applies. This tells your Sidekick what to focus on." onNext={next} onBack={back} canNext>
      <div className="flex flex-col gap-2.5">
        <button
          onClick={() => {
            const allLabels = NEEDS.map((n) => n.label);
            const allSelected = allLabels.every((l) => state.needs.includes(l));
            onUpdate({ needs: allSelected ? [] : allLabels });
          }}
          className="text-sm font-semibold text-accent self-end mb-1 hover:opacity-70 transition-opacity"
        >
          {NEEDS.every((n) => state.needs.includes(n.label)) ? "Deselect all" : "Select all"}
        </button>
        {NEEDS.map((n) => (
          <OptionCard
            key={n.label}
            icon={n.icon}
            title={n.label}
            desc={n.desc}
            selected={state.needs.includes(n.label)}
            onClick={() => onUpdate({ needs: toggle(state.needs, n.label) })}
            multi
          />
        ))}
      </div>
    </StepWrapper>,

    // 7: Lifestyle
    <StepWrapper key="lifestyle" title="A few more things about your life" hint="This helps your Sidekick be proactive — not just reactive." onNext={next} onBack={back} canNext>
      <div className="flex flex-col gap-6">
        <div>
          <div className="text-sm font-semibold text-text-primary mb-2.5">When do you wake up?</div>
          <div className="grid grid-cols-3 gap-2.5">
            {WAKE_TIMES.map((w) => (
              <button
                key={w.val}
                onClick={() => onUpdate({ wakeTime: w.val })}
                className={`flex flex-col items-center gap-1 p-4 rounded-2xl border-2 transition-all ${
                  state.wakeTime === w.val
                    ? "border-accent bg-[#fafafa]"
                    : "border-[#f0f0f0] hover:border-[#d1d1d6]"
                }`}
              >
                <span className="text-2xl">{w.icon}</span>
                <span className="text-sm font-semibold text-text-primary">{w.label}</span>
                <span className="text-[11px] text-text-muted">{w.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-text-primary mb-2.5">Dietary preferences</div>
          <div className="flex flex-col gap-2">
            {DIET_OPTIONS.map((d) => (
              <OptionCard
                key={d}
                title={d}
                selected={state.diet.includes(d)}
                onClick={() => onUpdate({ diet: toggle(state.diet, d) })}
                multi
                compact
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-text-primary mb-2.5">How do you get around?</div>
          <div className="grid grid-cols-2 gap-2.5">
            {COMMUTE_OPTIONS.map((c) => (
              <button
                key={c.val}
                onClick={() => onUpdate({ commute: toggle(state.commute, c.val) })}
                className={`flex flex-col items-center gap-1 p-4 rounded-2xl border-2 transition-all ${
                  state.commute.includes(c.val)
                    ? "border-accent bg-[#fafafa]"
                    : "border-[#f0f0f0] hover:border-[#d1d1d6]"
                }`}
              >
                <span className="text-2xl">{c.icon}</span>
                <span className="text-sm font-semibold text-text-primary">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </StepWrapper>,

    // 8: Location
    <StepWrapper key="location" title="Where are you based?" hint="Your Sidekick uses your location for weather, nearby spots, and proactive suggestions." onNext={next} onBack={back} canNext>
      <div className="flex flex-col items-center gap-5">
        {locationStatus === "idle" && (
          <>
            <div className="w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center text-4xl">
              📍
            </div>
            <button
              onClick={requestLocation}
              className="w-full py-4 rounded-full font-semibold text-[17px] tracking-tight bg-accent text-white active:scale-[0.97] transition-all"
            >
              Enable Location
            </button>
            <p className="text-xs text-text-muted text-center">
              We&apos;ll detect your city automatically. You can always change it later.
            </p>
          </>
        )}
        {locationStatus === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-text-muted">Detecting your location...</p>
          </div>
        )}
        {locationStatus === "granted" && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full bg-[#e8f5e9] flex items-center justify-center text-4xl">
              ✅
            </div>
            <div className="text-xl font-bold text-text-primary">{state.location || "Location detected"}</div>
            <p className="text-sm text-text-muted text-center">
              Your Sidekick will use this for weather, restaurants, and proactive alerts.
            </p>
          </div>
        )}
        {locationStatus === "denied" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center text-4xl">
              📍
            </div>
            <p className="text-sm text-text-muted text-center">
              Location access was denied. You can enter your city manually instead.
            </p>
            <input
              type="text"
              value={state.location}
              onChange={(e) => onUpdate({ location: e.target.value })}
              placeholder="e.g. Salem, MA"
              className="w-full border-b-2 border-[#e5e5e5] focus:border-accent bg-transparent px-0 py-3 text-lg text-text-primary placeholder:text-[#d1d1d6] outline-none transition-colors text-center"
            />
          </div>
        )}
        <Callout icon="🔒">Your exact coordinates are stored securely and never shared publicly. Only used to personalize your experience.</Callout>
      </div>
    </StepWrapper>,

    // 9: Name your sidekick
    <StepWrapper key="sidekickName" title="Name your Sidekick." hint="This is who's texting you every morning. Make it feel right." onNext={next} onBack={back} canNext={state.sidekickName.length > 0}>
      <input
        type="text"
        value={state.sidekickName}
        onChange={(e) => onUpdate({ sidekickName: e.target.value })}
        placeholder="e.g. Josh, Mia, Alex, Luna..."
        autoFocus
        className="w-full border-b-2 border-[#e5e5e5] focus:border-accent bg-transparent px-0 py-3 text-[28px] font-bold text-center text-text-primary placeholder:text-[#d1d1d6] outline-none transition-colors tracking-tight"
      />
      <Callout icon="💭">You can always change this later. Some people pick a friend&apos;s name. Some pick a celebrity. Some make one up.</Callout>
    </StepWrapper>,

    // 10: Morning briefing opt-in
    <StepWrapper key="briefing" title={`Want ${state.sidekickName || "your Sidekick"} to text you every morning?`} hint="A daily rundown of your weather, schedule, tasks — plus proactive suggestions like rides, dinner ideas, and grocery orders." onNext={next} onBack={back} canNext>
      <div className="flex flex-col items-center gap-6">
        <div className="w-full max-w-sm bg-[#f8f8f8] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Preview</span>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-sm text-text-primary leading-relaxed">
            <p>hey {state.name || "there"}! ☀️ it&apos;s 72° and sunny today. you&apos;ve got a 10am standup and lunch with Sarah at 12:30 on Main St — want me to book a ride? i don&apos;t see dinner plans yet, want me to start thinking about that? your wallet&apos;s at $40. just text me if you need anything today 💛</p>
          </div>
          <div className="text-[11px] text-text-muted mt-2 text-center">
            Sent daily at your wake time
          </div>
        </div>

        <div className="flex gap-3 w-full">
          <button
            onClick={() => onUpdate({ morningBriefing: true })}
            className={`flex-1 flex flex-col items-center gap-2 p-5 rounded-2xl border-2 transition-all ${
              state.morningBriefing
                ? "border-accent bg-[#fafafa]"
                : "border-[#f0f0f0] hover:border-[#d1d1d6]"
            }`}
          >
            <span className="text-3xl">☀️</span>
            <span className="text-[15px] font-semibold text-text-primary">Yes, wake me up</span>
            <span className="text-xs text-text-muted">Daily morning text</span>
          </button>
          <button
            onClick={() => onUpdate({ morningBriefing: false })}
            className={`flex-1 flex flex-col items-center gap-2 p-5 rounded-2xl border-2 transition-all ${
              !state.morningBriefing
                ? "border-accent bg-[#fafafa]"
                : "border-[#f0f0f0] hover:border-[#d1d1d6]"
            }`}
          >
            <span className="text-3xl">🌙</span>
            <span className="text-[15px] font-semibold text-text-primary">Not yet</span>
            <span className="text-xs text-text-muted">Maybe later</span>
          </button>
        </div>

        <Callout icon="📱">
          {state.morningBriefing
            ? `${state.sidekickName || "Your Sidekick"} will text you at your phone number every morning. You can turn this off anytime.`
            : "You can always turn this on later in the briefing settings."}
        </Callout>
      </div>
    </StepWrapper>,
  ];

  const progress = step === 0 ? 0 : Math.round((step / (steps.length - 1)) * 100);

  return (
    <div className="h-full flex flex-col bg-white">
      {step > 0 && (
        <div className="px-7 pt-4">
          <div className="h-[3px] bg-[#f0f0f0] rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">
              {step <= 3 ? "About You" : step <= 7 ? "Your Life" : "Design Your Sidekick"}
            </span>
            <span className="text-[11px] text-text-muted font-medium">{progress}%</span>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">{steps[step]}</div>
    </div>
  );
}

function StepWrapper({
  title,
  hint,
  children,
  onNext,
  onBack,
  canNext,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  onNext: () => void;
  onBack: () => void;
  canNext: boolean;
}) {
  return (
    <div className="flex flex-col h-full px-7 py-6 animate-fade-up">
      <div className="mb-7">
        <h2 className="text-[28px] font-bold text-text-primary tracking-tight leading-tight mb-2">
          {title}
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">{hint}</p>
      </div>
      <div className="flex-1">{children}</div>
      <div className="flex gap-3 mt-6 pt-4">
        <button
          onClick={onBack}
          className="px-6 py-4 rounded-full text-text-secondary font-medium hover:bg-bg-secondary transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="flex-1 py-4 rounded-full font-semibold text-[17px] tracking-tight transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-white active:scale-[0.97]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function OptionCard({
  icon,
  title,
  desc,
  selected,
  onClick,
  multi,
  compact,
}: {
  icon?: string;
  title: string;
  desc?: string;
  selected: boolean;
  onClick: () => void;
  multi?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3.5 ${compact ? "px-4 py-3" : "px-4 py-4"} rounded-2xl border-2 text-left transition-all w-full ${
        selected
          ? "border-accent bg-[#fafafa]"
          : "border-[#f0f0f0] hover:border-[#d1d1d6] bg-white"
      }`}
    >
      {icon && (
        <div className="w-11 h-11 rounded-xl bg-bg-secondary flex items-center justify-center text-2xl shrink-0">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-text-primary tracking-tight">{title}</div>
        {desc && <div className="text-xs text-text-muted mt-0.5">{desc}</div>}
      </div>
      <div
        className={`w-[22px] h-[22px] ${multi ? "rounded-md" : "rounded-full"} border-2 flex items-center justify-center text-xs shrink-0 transition-all ${
          selected
            ? "bg-accent border-accent text-white"
            : "border-[#d1d1d6] text-transparent"
        }`}
      >
        ✓
      </div>
    </button>
  );
}

function StyleSlider({
  left,
  right,
  value,
  onChange,
}: {
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-[13px] font-semibold text-accent-light">{left}</span>
        <span className="text-[13px] font-semibold text-accent-light">{right}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function Callout({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 bg-bg-secondary rounded-2xl p-4 mt-4">
      <span className="text-xl shrink-0">{icon}</span>
      <p className="text-[13px] text-accent-light leading-relaxed">{children}</p>
    </div>
  );
}
