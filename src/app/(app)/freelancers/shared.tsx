"use client";

import { useState } from "react";

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

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", ILS: "₪" };
export const money = (n: number, c: string) =>
  `${SYMBOL[c] ?? `${c} `}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const hrs = (n: number) => `${Number(n.toFixed(2)).toLocaleString("en-US")}h`;
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
export const shortMonth = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1].slice(0, 3)} ${p.slice(2, 4)}`;
export const shiftMonth = (p: string, by: number) => {
  const i = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** "+ $150.00" for charges kept in another currency. */
export const otherLine = (o: { currency: string; amount: number }[]) => o.map((x) => ` + ${money(x.amount, x.currency)}`).join("");

export async function act(body: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/admin/freelancers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

/** A freelancer's rate terms, as the sentence they read as. Equal rates make a flat rate. */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (k: keyof Omit<Terms, "currency">) => (
    <input
      inputMode="decimal"
      value={String(t[k])}
      onChange={(e) => setT({ ...t, [k]: Number(e.target.value.replace(",", ".")) || 0 })}
      className={numCls}
    />
  );
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
      {children}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <select value={t.currency} onChange={(e) => setT({ ...t, currency: e.target.value })} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
          <option value="EUR">€ EUR</option>
          <option value="USD">$ USD</option>
          <option value="ILS">₪ ILS</option>
        </select>
        {num("rateHigh")}
        <span className="text-muted">/h up to</span>
        {num("hoursLow")}
        <span className="text-muted">h a month, sliding to</span>
        {num("rateLow")}
        <span className="text-muted">/h from</span>
        {num("hoursHigh")}
        <span className="text-muted">h</span>
      </div>
      <p className="text-xs text-muted">Same rate in both boxes = a flat hourly rate.</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await onSubmit(t));
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

