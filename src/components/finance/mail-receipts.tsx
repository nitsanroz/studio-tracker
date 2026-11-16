"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ExternalLink, FileSearch, Mail, Paperclip, Plus, RefreshCw, X } from "lucide-react";
import { rentNet, splitBill } from "@/lib/finance/mail/rent";
import { changed, EXPENSES_CHANGED, scanMail } from "@/lib/finance/advice/client";
import { formatShortDay, studioDay } from "@/lib/finance/format";
import { DocList } from "./doc-list";
import { InfoDot } from "./ui";
import type { Cleared, Suggestion } from "@/lib/finance/mail/receipts";

/** What the list left out, in Nitsan's words for it (2026-11-06: "clear that noise for me"). */
const CLEARED: [Cleared, string, string][] = [
  ["duplicate", "copy in another mailbox", "copies in another mailbox"],
  ["on-expenses", "already on Expenses", "already on Expenses"],
  ["reply", "reply or forward", "replies and forwards"],
  ["request", "payment request (not a tax invoice)", "payment requests (not tax invoices)"],
  ["client", "client's", "clients'"],
  ["freelance", "freelancer's (Freelance page)", "freelancers' (Freelance page)"],
  ["plan-line", "on its own Plan line", "on their own Plan line"],
];

/**
 * "From your mail" (v1.14.0, Nitsan 2026-11-05): receipts the billing scan
 * found that no expense row covers yet, each ready to add as a row — or to
 * dismiss, or to silence its sender for good. For everyone on Expenses
 * since v1.18.0 (Nitsan, 2026-11-08: "make sure Michal sees" them;
 * reference/0022) — only the owner can read the mail on the spot ("Read
 * now"), since the mailboxes are the owner's. Anyone else gets a 403 and
 * sees nothing.
 *
 * Laid out as cards (v1.17.0, Nitsan 2026-11-07: "hard to read, messy, very
 * textual"): when the mail was read and when it's read next on top; receipts
 * whose invoice isn't in the email first, with the button to go get it; then
 * the ones ready to add. Fields read as plain text and show they're editable
 * on hover; what needs explaining sits behind an ⓘ.
 */

interface Draft {
  vendor: string;
  description: string;
  category: Suggestion["category"];
  date: string;
  amount: string;
  currency: string;
  withVat: boolean;
  invoiceNumber: string;
  paidWith: string;
  /** a Rent tab bill (v1.24.0): its line, first month ("YYYY-MM"), and whether it covers two */
  rentLine: string;
  rentMonth: string;
  rentTwo: boolean;
}

/** The grid holds Rent amounts without VAT: the bill's total, VAT off when it includes it, split over its months. */
const rentShares = (d: Draft, months: string[]) => {
  const total = Number(d.amount);
  return total > 0 ? splitBill(rentNet(total, d.withVat, months[0]), months.length) : null;
};

/** A monthly row a receipt came after (Nitsan, 2026-11-07): shown on that row on Expenses. */
export interface AfterEndFlag {
  date: string;
  endDate: string;
  subject: string;
}

interface Scan {
  last: string | null;
  everyHours: number;
  mailboxes: string[];
  /** only the owner reads the mail on the spot */
  canRead?: boolean;
}

const draftOf = (s: Suggestion): Draft => {
  const rent = s.category === "rent";
  // A Rent bill shows what goes into the grid — its amount WITHOUT VAT (Nitsan, 2026-11-09: "it should
  // take the amount without VAT"); the bill's own total is noted beside it.
  const net = rent && s.amount != null && s.rentVat ? rentNet(s.amount, true, s.rentMonths?.[0] ?? s.date.slice(0, 7)) : s.amount;
  return {
    vendor: s.suggestedVendor,
    description: s.description,
    category: s.category,
    date: s.date,
    amount: net == null ? "" : Number.isInteger(net) ? String(net) : net.toFixed(2),
    currency: s.currency ?? "ILS",
    withVat: !rent && (s.currency ?? "ILS") === "ILS",
    invoiceNumber: s.invoiceNumber ?? "",
    paidWith: s.paidWith ?? "",
    rentLine: s.rentLine ?? "",
    rentMonth: s.rentMonths?.[0] ?? s.date.slice(0, 7),
    rentTwo: (s.rentMonths?.length ?? 1) > 1,
  };
};

/** "2026-09" → the month after. */
const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const monthsOf = (d: Draft) => (d.rentTwo ? [d.rentMonth, nextMonth(d.rentMonth)] : [d.rentMonth]);
/** "2026-09" → "Sep 2026". */
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Open only when the owner opened it (Nitsan, 2026-11-07: "fold them all by default"). */
const OPEN_KEY = "expenses.mailOpen";
/** A field that reads as text until the card is hovered or it's focused (Nitsan, 2026-11-07: "edit fields only on hover"). */
const field =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none transition-colors placeholder:text-faint group-hover/card:border-border hover:!border-border-strong focus:!border-brand focus:bg-surface";
const CATEGORY = { monthly: "Monthly", yearly: "Yearly", misc: "Misc", investment: "Investments", rent: "Rent" } as const;

/** "25 min ago", "3 h ago", "2 Nov 14:20". */
function ago(iso: string, now: number): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  // The studio's day and clock, not UTC's: a read at 01:00 Tel Aviv time said "yesterday" with toISOString.
  const time = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  return `${formatShortDay(studioDay(iso))} ${time}`;
}

function nextScan(scan: Scan, now: number): string {
  if (!scan.last) return "the next time the app opens";
  const h = (Date.parse(scan.last) + scan.everyHours * 3_600_000 - now) / 3_600_000;
  if (h <= 0) return "the next time the app opens";
  return h < 1 ? `in ${Math.max(1, Math.round(h * 60))} min` : `in about ${Math.round(h)} h`;
}

/** A small caps label over a value, with its ⓘ. */
function Labelled({ label, info, className = "", children }: { label: string; info?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="flex items-center gap-1 px-1.5 text-[10px] font-medium tracking-wide text-faint uppercase">
        {label}
        {info && <InfoDot>{info}</InfoDot>}
      </span>
      {children}
    </div>
  );
}

export function MailReceipts({
  onFlags,
  onAttached,
}: {
  onFlags?: (flags: Map<string, AfterEndFlag>) => void;
  /** receipts already on Expenses had their files put on their rows (v1.22.0) */
  onAttached?: () => void;
} = {}) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fold, setFold] = useState(true);
  const [vendors, setVendors] = useState<string[]>([]);
  const [rentLines, setRentLines] = useState<string[]>([]);
  const [cleared, setCleared] = useState<Partial<Record<Cleared, number>>>({});
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      setFold(localStorage.getItem(OPEN_KEY) !== "1");
    } catch {
      /* storage blocked — folded */
    }
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/finance/mail/receipts").catch(() => null);
    if (!res?.ok) return setList(null);
    const j = (await res.json()) as { suggestions: Suggestion[]; cleared?: Partial<Record<Cleared, number>>; vendors?: string[]; rentLines?: string[]; missing?: boolean; scan?: Scan; attached?: number; filled?: number };
    setMissing(!!j.missing);
    setVendors(j.vendors ?? []);
    setRentLines(j.rentLines ?? []);
    setCleared(j.cleared ?? {});
    setScan(j.scan ?? null);
    setNow(Date.now());
    setList(j.suggestions);
    onFlags?.(new Map(j.suggestions.filter((s) => s.afterEnd).map((s) => [s.afterEnd!.expenseId, { date: s.date, endDate: s.afterEnd!.endDate, subject: s.subject }])));
    setDrafts((d) => Object.fromEntries(j.suggestions.map((s) => [s.id, d[s.id] ?? draftOf(s)])));
    if (j.attached) onAttached?.();
    // Rows got their card, invoice number or description from a receipt (v1.23.0): the page reloads them.
    if (j.filled) window.dispatchEvent(new Event(EXPENSES_CHANGED));
  }, [onFlags, onAttached]);
  useEffect(() => {
    void load();
  }, [load]);

  const scanNow = async () => {
    setScanning(true);
    setNote(null);
    const ok = await scanMail();
    setScanning(false);
    if (!ok) setNote("Couldn't read the mail just now — Settings shows each mailbox's state.");
    await load();
  };

  if (!list) return null;
  if (missing)
    return <p className="mb-4 text-xs text-faint">Receipts from your mail need reference/0016_finance_mail_receipts.sql run in Supabase.</p>;
  // Nothing waiting: a slim line, so "Read now" is still there (Nitsan, 2026-11-09: "there's no such button").
  if (!list.length)
    return scan?.canRead === false ? null : (
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-4 py-2 text-xs text-muted">
        <Mail size={14} className="shrink-0" />
        <span>From your mail · nothing to add</span>
        <span className="ml-auto flex items-center gap-1.5">
          {scan?.last ? `Read ${ago(scan.last, now)} · next ${nextScan(scan, now)}` : "Not read yet"}
          <button onClick={() => void scanNow()} disabled={scanning} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-brand hover:bg-surface disabled:opacity-50">
            <RefreshCw size={12} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Reading…" : "Read now"}
          </button>
        </span>
        {note && <span className="w-full text-danger">{note}</span>}
      </div>
    );

  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const act = async (s: Suggestion, body: object, done: string) => {
    setBusy(s.id);
    setNote(null);
    const res = await fetch(`/api/finance/mail/receipts/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as { error?: string; warning?: string }) : {};
    setBusy(null);
    if (!res?.ok) return setNote(j.error ?? "Couldn't reach the server.");
    // An Add whose expense was made but whose follow-up write failed says so instead of "done".
    setNote(j.warning ?? done);
    if ("action" in body && (body.action === "add" || body.action === "rent")) changed();
    await load();
  };
  const toggle = () => {
    setFold((f) => {
      try {
        localStorage.setItem(OPEN_KEY, f ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      return !f;
    });
  };

  // The invoice isn't in the email: it has to be fetched from the vendor first (Nitsan, 2026-11-07).
  // A Rent bill needs no file first (Nitsan, 2026-11-09: "getting files is not a must").
  const fetchFirst = list.filter((s) => !s.docs?.length && s.category !== "rent");
  const ready = list.filter((s) => s.docs?.length || s.category === "rent");
  const leftOut = CLEARED.filter(([k]) => cleared[k]);
  const leftOutCount = leftOut.reduce((n, [k]) => n + (cleared[k] ?? 0), 0);
  const boxes = scan?.mailboxes.map((m) => `${m.split("@")[0]}@`).join(", ");

  const card = (s: Suggestion) => {
    const d = drafts[s.id] ?? draftOf(s);
    const rent = d.category === "rent";
    // A month LOCKED on the Rent tab keeps its amount: the bill's file and number go on its cell (v1.24.3);
    // a final cell in an open month takes the bill's amount and stays final (v1.24.4).
    const at = (m: string) => (d.rentLine === s.rentLine ? (s.rentMonths?.indexOf(m) ?? -1) : -1);
    const finalOf = (m: string) => !!s.rentFinal?.[at(m)];
    const lockedOf = (m: string) => !!s.rentLocked?.[at(m)];
    const attachOnly = rent && monthsOf(d).some(lockedOf);
    const updateFinal = rent && !attachOnly && monthsOf(d).some(finalOf);
    // Every month already has a cell: the bill can just go on them, amounts as they are.
    const hasCells = rent && monthsOf(d).every((m) => at(m) >= 0 && s.rentNow?.[at(m)] != null);
    const when = monthsOf(d).map(monthName).join(" and ");
    const rentHint = !rent
      ? null
      : attachOnly
        ? `${when} ${monthsOf(d).length > 1 ? "are" : "is"} locked on the Rent tab — Attach puts this bill on the cell; its amount stays.`
        : !(Number(d.amount) > 0)
          ? `The email doesn't show the amount. Open the bill and type its total${s.rentVat ? "" : " (no VAT on this one)"} — or, if the grid's amount is already right, Attach as is.`
          : updateFinal
            ? `The grid's amount for ${when} is final — Update puts the bill's in (it stays final; the Plan then asks you to accept the new total).`
            : `Add puts the bill's amount into ${when}.`;
    const ok = rent ? d.rentLine.trim() && /^\d{4}-\d{2}$/.test(d.rentMonth) && (Number(d.amount) > 0 || attachOnly) : d.vendor.trim() && Number(d.amount) > 0 && d.date;
    const isNew = !rent && !vendors.some((v) => v.trim().toLowerCase() === d.vendor.trim().toLowerCase());
    const similar = isNew ? (s.similar ?? []) : [];
    const noFile = !s.docs?.length;
    const getAt = s.invoiceUrl ?? s.billingUrl ?? s.mailUrl;
    const accounts = s.accounts ?? [s.account];
    return (
      <li key={s.id} className="group/card rounded-lg border border-border bg-surface p-3 transition-shadow hover:shadow-card">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto]">
          {/* What it is: vendor and description, the widest part. */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {rent ? (
                <select
                  aria-label="Rent line"
                  value={d.rentLine}
                  onChange={(e) => set(s.id, { rentLine: e.target.value })}
                  title="The Rent tab line this bill fills"
                  className={`${field} bidi-auto w-auto max-w-xs appearance-none text-left text-base font-semibold ${d.rentLine ? "" : "!border-warning/60 text-warning"}`}
                >
                  {!d.rentLine && <option value="">Which Rent line?</option>}
                  {[...new Set([...rentLines, ...(d.rentLine ? [d.rentLine] : [])])].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
              <input
                aria-label="Vendor"
                list="mail-vendors"
                value={d.vendor}
                onChange={(e) => set(s.id, { vendor: e.target.value })}
                title="Pick a vendor already on Expenses, or type a new one"
                className={`${field} bidi-auto max-w-xs text-left text-base font-semibold`}
              />
              )}
              {rent && (
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark" title="Goes into the Rent tab's grid, not a new Expenses row">
                  Rent tab
                </span>
              )}
              {isNew && (
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark" title="No expense row has this vendor yet — adding it starts a new one">
                  new vendor
                </span>
              )}
            </div>
            {rent ? (
              // What the grid holds now for these months — a plan the bill replaces, or an amount it changes.
              <p className="px-1.5 py-1 text-sm text-muted">
                {monthsOf(d)
                  .map((m, j) => {
                    const i = s.rentMonths?.indexOf(m) ?? -1;
                    const now = i >= 0 && d.rentLine === s.rentLine ? s.rentNow?.[i] : undefined;
                    const share = rentShares(d, monthsOf(d))?.[j];
                    const fmt = (v: number) => `₪${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
                    if (lockedOf(m)) return `${monthName(m)}: ${now == null ? "—" : fmt(now)} (locked)${share != null && now != null && Math.abs(share - now) > 1 ? ` · the bill says ${fmt(share)}` : ""}`;
                    if (finalOf(m)) return `${monthName(m)}: ${now == null ? "—" : fmt(now)} (final)${share != null ? ` → ${fmt(share)}` : ""}`;
                    return `${monthName(m)}: ${now == null ? "empty" : `${fmt(now)} now`}${share != null ? ` → ${fmt(share)}` : ""}`;
                  })
                  .join(" · ")}
                {/* The bill's own total, VAT in — the amount above is without it. */}
                {s.rentVat && s.amount != null && (
                  <span className="text-faint"> · the bill: ₪{s.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} with VAT</span>
                )}
                {/* What this card wants, in one line (Nitsan, 2026-11-09: "not sure what this box is telling me or asking me to do"). */}
                <span className="mt-0.5 block text-foreground">{rentHint}</span>
              </p>
            ) : (
            <input
              aria-label="Description"
              value={d.description}
              onChange={(e) => set(s.id, { description: e.target.value })}
              placeholder="What was it? — add a description"
              title={d.description || undefined}
              className={`${field} bidi-auto text-left text-muted`}
            />
            )}
          </div>

          {/* How much, and the decision. */}
          <div className="flex items-start gap-2 md:justify-end">
            <div className="flex items-center">
              <select
                aria-label="Currency"
                value={d.currency}
                onChange={(e) => set(s.id, { currency: e.target.value, withVat: e.target.value === "ILS" })}
                className={`${field} w-auto appearance-none px-1 text-right text-lg font-semibold`}
              >
                <option value="ILS">₪</option>
                <option value="USD">$</option>
                <option value="EUR">€</option>
              </select>
              <input
                aria-label="Amount"
                inputMode="decimal"
                value={d.amount}
                onChange={(e) => set(s.id, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                placeholder="Amount?"
                title={
                  s.amount == null
                    ? rent
                      ? "The email didn't say how much — type the amount without VAT"
                      : "The email didn't say how much — type it in from the invoice"
                    : rent && s.rentVat
                      ? `Without VAT — the bill's total is ₪${s.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} with VAT`
                      : "Read from the receipt"
                }
                className={`${field} w-28 text-lg font-semibold tabular-nums ${d.amount ? "" : "!border-warning/60 placeholder:text-warning"}`}
              />
            </div>
            <button
              disabled={!ok || busy === s.id}
              onClick={() =>
                void (rent
                  ? act(
                      s,
                      { action: "rent", line: d.rentLine, months: monthsOf(d), amount: Number(d.amount), withVat: d.withVat, filesOnly: attachOnly, invoiceNumber: d.invoiceNumber, paidWith: d.paidWith },
                      attachOnly
                        ? `The bill is on ${d.rentLine}'s ${monthsOf(d).map(monthName).join(" and ")} cell — its amount unchanged.`
                        : `${d.rentLine} filled on the Rent tab for ${monthsOf(d).map(monthName).join(" and ")}.`,
                    )
                  : act(s, { action: "add", ...d, amount: Number(d.amount) }, `${d.vendor.trim()} added to ${CATEGORY[d.category]}.`))
              }
              title={
                attachOnly
                  ? `${monthsOf(d).map(monthName).join(" and ")} is locked on the Rent tab: the bill's file and number go on the cell and its amount stays — reopen the month there to change it`
                  : updateFinal && ok
                    ? `Puts the bill's amount in ${d.rentLine}'s final ${monthsOf(d).map(monthName).join(" and ")} cell — it stays final, and the Plan asks you to accept the new total`
                  : ok
                    ? rent
                      ? `Fill ${d.rentLine} for ${monthsOf(d).map(monthName).join(" and ")} on the Rent tab`
                      : `Add to ${CATEGORY[d.category]}`
                    : rent
                      ? "Needs a Rent line, a month and an amount"
                      : "Needs a vendor, an amount and a date"
              }
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
            >
              {attachOnly ? <Paperclip size={14} /> : <Plus size={14} />}
              {attachOnly ? "Attach" : updateFinal ? "Update" : "Add"}
            </button>
            {/* The grid already has the right amount: just put the bill on its cells. */}
            {rent && !attachOnly && hasCells && (
              <button
                disabled={busy === s.id || !d.rentLine.trim()}
                onClick={() =>
                  void act(
                    s,
                    { action: "rent", line: d.rentLine, months: monthsOf(d), amount: Number(d.amount) || 0, withVat: d.withVat, filesOnly: true, invoiceNumber: d.invoiceNumber, paidWith: d.paidWith },
                    `The bill is on ${d.rentLine}'s ${when} cell — its amount unchanged.`,
                  )
                }
                title={`The grid's amount for ${when} is right: put this bill (its link, file and number) on the cell and leave the amount`}
                className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg border border-brand/40 px-2.5 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft disabled:opacity-40"
              >
                <Paperclip size={14} />
                Attach as is
              </button>
            )}
            <button
              disabled={busy === s.id}
              onClick={() => void act(s, { action: "dismiss" }, "Dismissed — not an expense.")}
              title="Not an expense — remove just this one"
              aria-label="Dismiss"
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* The details, labelled. One date: the expense's (Nitsan, 2026-11-07: "why does the date appear twice?"). */}
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 sm:grid-cols-[8rem_10rem_minmax(0,1fr)] lg:grid-cols-[8rem_10rem_minmax(0,1fr)_minmax(0,1fr)_5rem]">
          <Labelled label="Kind" info={s.why ? `${s.why}.` : "Guessed from the vendor's rows on Expenses, or from how often it bills. Monthly and Yearly rows renew on their own; Misc is a one-off running cost, Investment a one-off purchase kept as capital spend; Rent fills a line of the Rent tab's grid."}>
            <select aria-label="Category" value={d.category} onChange={(e) => set(s.id, { category: e.target.value as Draft["category"] })} className={`${field} appearance-none`}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="misc">Misc</option>
              <option value="investment">Investment</option>
              <option value="rent">Rent</option>
            </select>
          </Labelled>
          {rent ? (
            <Labelled label={d.rentTwo ? "Months" : "Month"} info="The month(s) of the Rent grid this bill fills. Electricity, arnona and water bill two months at once: the amount is split between them. Guessed from the line's pairs on the grid — change it if the bill names another period.">
              <span className="flex items-center gap-1.5">
                <input aria-label="First month" type="month" value={d.rentMonth} onChange={(e) => set(s.id, { rentMonth: e.target.value })} className={`${field} w-auto`} />
                <label className="flex shrink-0 items-center gap-1 text-xs text-muted" title="The bill covers this month and the next">
                  <input type="checkbox" checked={d.rentTwo} onChange={(e) => set(s.id, { rentTwo: e.target.checked })} />2
                </label>
              </span>
            </Labelled>
          ) : (
            <Labelled label="Date" info={`The day the email came (${formatShortDay(s.date)}) — the day the expense counts in. Change it if the invoice gives another day.`}>
              <input aria-label="Date" type="date" value={d.date} onChange={(e) => set(s.id, { date: e.target.value })} className={field} />
            </Labelled>
          )}
          <Labelled label="Invoice no.">
            <input aria-label="Invoice number" value={d.invoiceNumber} onChange={(e) => set(s.id, { invoiceNumber: e.target.value })} placeholder="—" className={`${field} tabular-nums`} />
          </Labelled>
          {/* Room for "Mastercard ••5065" in a narrow window: two columns there. */}
          <Labelled label="Paid with" className="sm:col-span-2 lg:col-span-1">
            <input aria-label="Paid with" value={d.paidWith} onChange={(e) => set(s.id, { paidWith: e.target.value })} placeholder="—" className={field} />
          </Labelled>
          {d.currency === "ILS" && (
            <Labelled label="VAT" info="Is VAT inside the amount? ₪ receipts usually include it. Foreign-currency ones carry no VAT.">
              <label className="flex items-center gap-1.5 px-1.5 py-1 text-sm">
                <input type="checkbox" checked={d.withVat} onChange={(e) => set(s.id, { withVat: e.target.checked })} />
                incl.
              </label>
            </Labelled>
          )}
        </div>

        {/* The invoice isn't in the email — the one thing to do before adding it (Nitsan, 2026-11-07). */}
        {/* A login-only bill (water): the email only says it's ready (Nitsan, 2026-11-09). */}
        {rent && s.rentLogin && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-brand-soft/60 px-2.5 py-2 text-xs text-foreground">
            <FileSearch size={14} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              {s.rentLogin.site} keeps the bill behind its login — the email only says it&apos;s ready. Type the amount for {monthsOf(d).map(monthName).join(" + ")} <b>without VAT</b>.
            </span>
            {/* This bill's own link from the email; else the email itself — never the site's home page (2026-11-09). */}
            <a href={s.invoiceUrl ?? s.mailUrl ?? s.rentLogin.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 py-1 font-medium text-white hover:bg-brand-dark">
              {s.invoiceUrl ? "Open the bill" : "Open the email"}
              <ExternalLink size={12} />
            </a>
          </div>
        )}
        {/* A Rent bill with no file (Nitsan, 2026-11-09: "files aren't a must"): its link goes on the cell. */}
        {rent && !s.rentLogin && noFile && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            No file in the email{s.invoiceUrl ? " — its link is kept on the cell" : ""}.
            {getAt && (
              <a href={getAt} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                {s.invoiceUrl ? "Open the bill" : "Open the email"}
                <ExternalLink size={11} />
              </a>
            )}
          </p>
        )}
        {noFile && !rent && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-foreground">
            <FileSearch size={14} className="shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              {s.invoiceUrl ? (
                <>
                  The invoice isn&apos;t attached — <bdi className="font-semibold">{d.vendor}</bdi>{" "}keeps it on its own site. Download it there, add the expense, then attach the file from the row&apos;s receipt icon.
                </>
              ) : (
                <>
                  This email doesn&apos;t carry the invoice. Get it from <b className="bidi-auto">{d.vendor}</b>
                  {s.billingUrl ? "'s billing page" : " (the email says where)"}, add the expense, then attach the file from the row&apos;s receipt icon.
                </>
              )}
            </span>
            {getAt && (
              <a href={getAt} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-warning px-2.5 py-1 font-medium text-white hover:opacity-90">
                {s.invoiceUrl || s.billingUrl ? "Get the invoice" : "Open the email"}
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        {/* Charged after its monthly row ended — a mistake, or still running? (Nitsan, 2026-11-07) */}
        {s.afterEnd && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-2 text-xs text-danger">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              <b className="bidi-auto">{s.afterEnd.vendor.trim()}</b>&apos;s monthly row ended {formatShortDay(s.afterEnd.endDate)}, but this receipt is from {formatShortDay(s.date)}.
              {s.repeats > 0
                ? ` ${s.repeats} more came after it, so it looks like it's still running: clear the row's end date rather than adding a line.`
                : " Still running? Clear the row's end date rather than adding a line. Meant to stop? The charge may be worth checking."}
            </span>
          </p>
        )}

        {/* A close name already on Expenses — pick it rather than open a second vendor (Nitsan, 2026-11-07). */}
        {similar.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Already on Expenses?
            {similar.map((v) => (
              <button key={v} onClick={() => set(s.id, { vendor: v })} className="bidi-auto rounded-full border border-brand/40 px-2 py-0.5 text-brand hover:bg-brand-soft">
                {v}
              </button>
            ))}
          </p>
        )}

        {/* Where it came from: its files, the email, the mailbox. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-faint">
          {s.docs?.length ? <DocList docs={s.docs} /> : null}
          {s.mailUrl && !noFile && (
            <a href={s.mailUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
              <Mail size={12} />
              Open the email
            </a>
          )}
          <span className="bidi-auto min-w-0 max-w-full truncate md:max-w-[30rem]" title={`“${s.subject}” — to ${accounts.join(", ")}`}>
            {accounts.map((a) => `${a.split("@")[0]}@`).join(" + ")} · {s.subject}
          </span>
          {s.repeats > 0 && (
            <span
              className="cursor-help rounded-full bg-surface-2 px-2 py-0.5 text-muted"
              title={`${s.repeats} later ${s.repeats === 1 ? "receipt" : "receipts"} from them — one monthly row covers ${s.repeats === 1 ? "it" : "them"}, so they aren't listed separately.`}
            >
              +{s.repeats} later
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1">
            <button disabled={busy === s.id} onClick={() => void act(s, { action: "ignore" }, `Nothing from ${s.domain} will be suggested again.`)} className="hover:text-danger">
              Never suggest {s.domain}
            </button>
            <InfoDot>
              Stops suggesting anything from <b>{s.domain}</b> — for a sender that&apos;s never a studio expense (personal shopping, a client&apos;s billing system). Its other waiting receipts go too. To dismiss only this one, use the ✕.
            </InfoDot>
          </span>
        </div>
      </li>
    );
  };

  const group = (title: string, items: Suggestion[], info: ReactNode, warn: boolean) =>
    items.length > 0 && (
      <section className="space-y-2">
        <h3 className={`flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase ${warn ? "text-warning" : "text-muted"}`}>
          {title} · {items.length}
          <InfoDot>{info}</InfoDot>
        </h3>
        <ul className="space-y-2">{items.map(card)}</ul>
      </section>
    );

  return (
    // Tinted, so it reads as something to deal with (Nitsan, 2026-11-07: "a different colour, not white").
    <section data-advice="mail-receipts" className="mb-4 overflow-hidden rounded-xl border border-warning/40 bg-warning/10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <button onClick={toggle} aria-expanded={!fold} className="flex min-w-0 flex-wrap items-center gap-2 text-left">
          <Mail size={16} className="shrink-0 text-warning" />
          <span className="text-sm font-medium">
            From your mail · {list.length} {list.length === 1 ? "receipt" : "receipts"} to add
          </span>
          {fetchFirst.length > 0 && <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-white">{fetchFirst.length} need the invoice</span>}
        </button>
        {/* When the mail was read, and when it's read next (Nitsan, 2026-11-07). */}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          {scan?.last ? `Read ${ago(scan.last, now)} · next ${nextScan(scan, now)}` : "Not read yet"}
          <InfoDot>
            The app reads the billing mail of {boxes || "the connected mailboxes"} every {scan?.everyHours ?? 6} hours, whenever the owner has it open — there&apos;s no background job. Receipts from the last 4 months stay listed here until someone adds or dismisses them.
            {scan?.canRead !== false && <> &ldquo;Read now&rdquo; reads the mail at once.</>}
          </InfoDot>
          {scan?.canRead !== false && (
            <button onClick={() => void scanNow()} disabled={scanning} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-brand hover:bg-surface/70 disabled:opacity-50">
              <RefreshCw size={12} className={scanning ? "animate-spin" : ""} />
              {scanning ? "Reading…" : "Read now"}
            </button>
          )}
        </span>
        <button onClick={toggle} aria-label={fold ? "Show the receipts" : "Hide the receipts"} className="shrink-0 text-faint">
          <ChevronDown size={16} className={`transition-transform ${fold ? "" : "rotate-180"}`} />
        </button>
      </div>
      {!fold && (
        <div className="space-y-4 border-t border-warning/30 bg-surface-2/60 p-3 md:p-4">
          <datalist id="mail-vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {note && <p className="text-xs text-muted">{note}</p>}
          {group(
            "Get the invoice first",
            fetchFirst,
            "These emails don't carry the invoice — only a link or a log-in to the vendor's own system. Get it there, add the expense, then attach the file from the row's receipt icon.",
            true,
          )}
          {group("Ready to add", ready, "The invoice is attached and its details were read from it. Check them, change anything on hover, then Add.", false)}
          {leftOutCount > 0 && (
            <p className="flex items-center gap-1 text-xs text-faint">
              {leftOutCount} more left out
              <InfoDot>
                Not suggested, so you don&apos;t have to: {leftOut.map(([k, one, many]) => `${cleared[k]} ${cleared[k] === 1 ? one : many}`).join(" · ")}.
              </InfoDot>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
