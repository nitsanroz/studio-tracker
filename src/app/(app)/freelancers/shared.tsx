"use client";

import { useState } from "react";
import { dayLabel, hrs, money, monthLabel, shiftMonth, shortMonth } from "@/lib/freelancer-format";

// Shared by /freelancers (everyone) and /freelancers/[profileId] (one
// freelancer's month) — 0054–0056. Everything goes through /api/admin/freelancers.

export interface Terms {
  currency: string;
  rateHigh: number;
  rateLow: number;
  hoursLow: number;
  hoursHigh: number;
}
export interface Freelancer {
  profileId: string;
  name: string;
  token: string;
  /** A studio member billed as a freelancer (Dima): his hours are his own
   * time entries — no link, nothing to review. */
  hasLogin: boolean;
  active: boolean;
  terms: Terms;
  clientIds: string[];
  deliverables: { title: string; url: string; date: string }[];
  month: {
    hours: number;
    rate: number;
    hoursBill: number;
    extras: number;
    otherExtras: { currency: string; amount: number }[];
    total: number;
  };
  pendingCount: number;
  pendingMonths: string[];
}

// The formatters live in lib/freelancer-format.ts (shared with the /log page);
// re-exported so these pages keep importing them from here.
export { money, hrs, dayLabel, monthLabel, shortMonth, shiftMonth };

/** "+ $150.00" for charges kept in another currency. */
export const otherLine = (o: { currency: string; amount: number }[]) => o.map((x) => ` + ${money(x.amount, x.currency)}`).join("");

export async function act(body: Record<string, unknown>): Promise<string | null> {
  // ⚠️ A network failure is an ERROR STRING too, never a throw: a rejection left
  // Approve / Save terms / Save stuck busy at every caller (the 90485ac class).
  const r = await fetch("/api/admin/freelancers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return "Couldn't reach the server — try again.";
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.error ?? "Something went wrong";
}

/** "€55.00/h up to 50h a month, sliding to €45.00/h from 150h" — or a flat rate. */
export function termsLine(t: Terms): string {
  if (t.rateHigh === t.rateLow) return `${money(t.rateHigh, t.currency)}/h, flat`;
  return `${money(t.rateHigh, t.currency)}/h up to ${t.hoursLow}h a month, sliding to ${money(t.rateLow, t.currency)}/h from ${t.hoursHigh}h`;
}

const numCls = "w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums";

/** A freelancer's rate terms, as the sentence they read as — flat or sliding.
 * Flat is stored as equal rates. */
export function TermsForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  children,
}: {
  initial: Terms;
  submitLabel: string;
  onSubmit: (t: Terms) => Promise<string | null>;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const [t, setT] = useState(initial);
  const [flat, setFlat] = useState(initial.rateHigh === initial.rateLow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ⚠️ The field shows what was TYPED, not `String(Number(...))`: that turned "47."
  // back into "47" mid-typing (a decimal rate couldn't be typed, only pasted) and
  // snapped a cleared field to 0. The number saved is computed exactly as before.
  const [typed, setTyped] = useState<Partial<Record<keyof Omit<Terms, "currency">, string>>>({});
  const num = (k: keyof Omit<Terms, "currency">) => (
    <input
      inputMode="decimal"
      value={typed[k] ?? String(t[k])}
      onChange={(e) => {
        setTyped({ ...typed, [k]: e.target.value });
        setT({ ...t, [k]: Number(e.target.value.replace(",", ".")) || 0 });
      }}
      className={numCls}
    />
  );
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
      {children}
      <div className="flex w-fit rounded-md border border-border bg-surface p-0.5 text-xs">
        {[
          [true, "Flat rate"],
          [false, "Sliding rate"],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setFlat(v as boolean)}
            className={`rounded px-2.5 py-1 ${flat === v ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <select value={t.currency} onChange={(e) => setT({ ...t, currency: e.target.value })} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
          <option value="EUR">€ EUR</option>
          <option value="USD">$ USD</option>
          <option value="ILS">₪ ILS</option>
        </select>
        {num("rateHigh")}
        {flat ? (
          <span className="text-muted">/h</span>
        ) : (
          <>
            <span className="text-muted">/h up to</span>
            {num("hoursLow")}
            <span className="text-muted">h a month, sliding to</span>
            {num("rateLow")}
            <span className="text-muted">/h from</span>
            {num("hoursHigh")}
            <span className="text-muted">h</span>
          </>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // A flat rate is stored as equal rates; the hour marks only need to
            // pass the band check (hours_low < hours_high).
            const sent = flat
              ? { ...t, rateLow: t.rateHigh, ...(t.hoursLow < t.hoursHigh ? {} : { hoursLow: 0, hoursHigh: 1 }) }
              : t;
            setError(await onSubmit(sent));
            setBusy(false);
          }}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

