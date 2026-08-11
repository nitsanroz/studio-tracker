// The three shapes this app has been writing out by hand, ~1,900 times.
//
// Before this file: 23 distinct class strings for the brand button, 45 for the
// bordered input (5 padding variants of one recipe), and ~39 for the card, with
// three different shadow treatments on what is nominally the same object. There
// was no Button, Input or Card anywhere — `ui.tsx` has Modal, Tabs, Avatar and
// friends, but nothing for the primitives underneath them.
//
// ⚠️ EVERY VARIANT BELOW EMITS THE CLASS STRING THAT ALREADY SHIPS, verbatim.
// That is the whole point: converting a call site has to be provably a no-op, or
// nobody can review the conversion of a live app that eight people use daily.
// Where the existing strings disagreed, the most-used one won and the runners-up
// are named in a comment so the choice is auditable rather than silent.
//
// The values were counted, not guessed:
//   brand md    `bg-brand px-3 py-1.5 text-sm` — 10 sites, the plurality
//   ink md      `bg-foreground … hover:bg-black` — 3 sites
//   input       `rounded-md border border-border bg-surface px-2 py-1.5 text-sm` — 36
//   card        `rounded-2xl border border-border bg-surface p-4 shadow-card` — 14
//
// ⚠️ THERE IS NO WEIGHT PROP, and there must never be one. globals.css collapses
// `.font-medium`, `.font-semibold` AND `.font-bold` onto a single weight (570) —
// Saans is used at 380 and 570 and nothing else. So `font-medium` and
// `font-semibold` render IDENTICALLY, which is exactly how 23 button strings
// grew from about 5 real buttons: each author picked a weight, none of them did
// anything, and the strings diverged anyway. Hierarchy here is size, colour and
// spacing. (Two shipped bugs came from this — v1.7.0 and v1.9.3.)

import type { ComponentProps, ReactNode } from "react";

/* ── Button ─────────────────────────────────────────────────────────────── */

type ButtonVariant = "brand" | "ink" | "ghost" | "danger";
/** `touch` is 44px tall — the iOS/WCAG minimum for a tap target. Mobile only. */
type ButtonSize = "sm" | "md" | "touch";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // The dominant string had `rounded-md`; a near-equal population used
  // `rounded-lg`. md wins because it matches the input radius, so a button
  // beside a field reads as the same family.
  brand: "bg-brand text-white hover:bg-brand-dark disabled:opacity-40",
  // `hover:bg-black` rather than a token: there is no darker-than-foreground
  // token, and this is what the three existing sites do.
  ink: "bg-foreground text-white hover:bg-black disabled:opacity-40",
  ghost:
    "border border-border bg-surface text-foreground hover:border-brand disabled:opacity-40",
  danger: "bg-danger text-white hover:brightness-90 disabled:opacity-40",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "rounded-md px-3 py-1 text-xs",
  md: "rounded-md px-3 py-1.5 text-sm",
  // `min-h-11` is 44px exactly. Padding alone can't be trusted for this —
  // py-2.5 plus text-sm's line box lands at 40px, and 4px short of the minimum
  // is the difference between hitting a control and hitting the row behind it.
  touch: "min-h-11 rounded-lg px-4 text-sm",
};

export function Button({
  variant = "brand",
  size = "md",
  className = "",
  ...rest
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...rest}
      className={`${BUTTON_SIZE[size]} font-medium ${BUTTON_VARIANT[variant]} ${className}`}
    />
  );
}

/* ── Fields ─────────────────────────────────────────────────────────────── */

// ⚠️ This includes `outline-none focus:border-brand`, which only 9 of the 36
// existing input sites carry. The other 27 have NO focus indication at all — a
// keyboard user cannot see where they are. So converting one of those 27 DOES
// change rendered output, on focus only, and in the direction of the 9 that were
// already right. That is the one intentional visual change in this file; flag it
// when converting rather than letting it look like an accident.
const CONTROL =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand";

export function Input({ className = "", ...rest }: ComponentProps<"input">) {
  return <input {...rest} className={`${CONTROL} ${className}`} />;
}

export function Select({ className = "", ...rest }: ComponentProps<"select">) {
  return <select {...rest} className={`${CONTROL} ${className}`} />;
}

export function Textarea({ className = "", ...rest }: ComponentProps<"textarea">) {
  return <textarea {...rest} className={`${CONTROL} ${className}`} />;
}

/**
 * Label above control. The label is a real `<label>` wrapping its input, so the
 * hit area includes the text and no `htmlFor`/`id` pair has to be invented and
 * kept unique — which is why the app's existing hand-rolled labels are mostly
 * bare `<div>`s that don't focus anything when tapped.
 */
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  /** Sits under the control — for a format note or a validation message. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-ui-label text-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

/* ── Card ───────────────────────────────────────────────────────────────── */

// `p-4` is the plurality (14 sites); `none` exists because 6 sites pad their own
// children instead, usually because a header band bleeds to the card's edge.
const CARD_PAD = { none: "", sm: "p-3", md: "p-4", lg: "p-6" } as const;

export function Card({
  pad = "md",
  className = "",
  children,
  ...rest
}: ComponentProps<"div"> & { pad?: keyof typeof CARD_PAD }) {
  return (
    <div
      {...rest}
      className={`rounded-2xl border border-border bg-surface shadow-card ${CARD_PAD[pad]} ${className}`}
    >
      {children}
    </div>
  );
}
