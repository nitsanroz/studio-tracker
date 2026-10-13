"use client";

// Vacation (migration 0058): the request form, the card on Home and the
// Vacation page, and the owner's list of requests to decide.
//
// The balance is the person's latest payslip (imported by finance-admin) less
// what's approved or asked for since — see lib/vacation.ts. Whole days only,
// and a request always carries a message.
//
// ⚠️ NO PAYSLIP = NO DAY LIMIT. A freelancer (Dima) isn't on payroll, so has no
// vacation account to draw down — but his days off still need Nitsan's yes, so
// he requests like everyone else, just without the balance check (Nitsan,
// 2026-10-13). The catch: an employee whose first payslip isn't imported yet
// reads the same way until it is — the approver still sees every request.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, TreePalm, X } from "lucide-react";
import { Modal, ModalClose } from "./ui";
import { Button, Field, Input, Textarea } from "./primitives";
import { askConfirm } from "./confirm-dialog";
import { useData } from "@/lib/store";
import { MONTH_NAMES_SHORT, formatDate, toISODate } from "@/lib/format";
import { availableDays, fitRequest, formatDays, plannedVacation, workdays, type VacationRequest } from "@/lib/vacation";
import type { VacationState } from "@/lib/use-vacation";

const STATUS: Record<VacationRequest["status"], { label: string; className: string }> = {
  pending: { label: "Waiting for approval", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-background text-muted" },
};

export function VacationStatusPill({ status }: { status: VacationRequest["status"] }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[status].className}`}>
      {STATUS[status].label}
    </span>
  );
}

/** "2026-11" → "November". */
const monthName = (key: string) =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: "long" });

const range = (r: Pick<VacationRequest, "startDate" | "endDate">) =>
  r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`;

// ── the request form ──────────────────────────────────────────────────────

export function VacationRequestModal({
  vacation,
  startDate,
  onClose,
}: {
  vacation: VacationState;
  /** Prefilled from a weekly-plan cell. */
  startDate?: string;
  onClose: () => void;
}) {
  const { dayStates, planColumns, planEntries } = useData();
  const today = toISODate(new Date());
  const [from, setFrom] = useState(startDate ?? today);
  const [to, setTo] = useState(startDate ?? today);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** They've ticked that they know it's more than they'll have (Nitsan, 2026-10-13:
   * allowed, but only knowingly — he sees the shortfall when deciding). */
  const [overOk, setOverOk] = useState(false);
  const dates = workdays(from, to, dayStates);
  const days = dates.length;
  const mine = vacation.requests.filter((r) => r.profileId === vacation.mineProfileId);
  // Judged against what they'll have by each month the days fall in — a day's
  // credit for every month after the payslip's.
  const planned = plannedVacation(vacation.mineProfileId, planColumns, planEntries);
  const fit = vacation.mine && days ? fitRequest(vacation.mine, mine, dayStates, dates, undefined, new Date(), planned) : null;
  const tooMany = fit != null && !fit.ok;
  const shortBy = tooMany
    ? `By ${monthName(fit!.short!.month)} you'd be ${formatDays(fit!.short!.by)} day${fit!.short!.by === 1 ? "" : "s"} short.`
    : null;
  const problem =
    to < from
      ? "The last day is before the first."
      : from < today
        ? "Vacation can't start in the past."
        : days === 0
          ? "No workdays in these dates (Fri–Sat and holidays don't count)."
          : tooMany && !overOk
            ? shortBy
            : !message.trim()
              ? "Add a message for Nitsan."
              : null;

  async function submit() {
    if (problem) return;
    setBusy(true);
    const ok = await vacation.request({ startDate: from, endDate: to, message });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal onClose={onClose} width="sm" labelledBy="vacation-title">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="vacation-title" className="font-heading text-base">
          Request vacation
        </h2>
        <ModalClose onClose={onClose} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="First day">
            <Input
              type="date"
              value={from}
              min={today}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
              }}
            />
          </Field>
          <Field label="Last day">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <p className="text-sm">
          <span className="font-medium">{days}</span> workday{days === 1 ? "" : "s"}
          {!vacation.mine && <span className="text-muted"> · no day limit — Nitsan approves</span>}
          {fit && !tooMany && (
            <span className="text-muted">
              {" "}
              · {formatDays(fit.leftAfter)} left at the end of {monthName(dates[dates.length - 1].slice(0, 7))} after this
            </span>
          )}
        </p>
        <Field label="Message">
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Where to, or anything Nitsan should know"
            className="bidi-auto"
            autoFocus
          />
        </Field>
        {(problem && problem !== shortBy && (message.trim() || problem !== "Add a message for Nitsan.")) || vacation.error ? (
          <p className="text-xs text-danger">{vacation.error ?? problem}</p>
        ) : null}
        {tooMany && (
          <label className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-800">
            <input type="checkbox" checked={overOk} onChange={(e) => setOverOk(e.target.checked)} className="mt-0.5" />
            <span>
              {shortBy} I know this is more vacation than I&apos;ll have — send it anyway.
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!problem || busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
        <p className="text-[11px] text-muted">Whole days only. Nitsan approves; once he does, the days show in the weekly plan.</p>
      </div>
    </Modal>
  );
}

// ── your balance and requests ─────────────────────────────────────────────

/** The Home card, and the top of the Vacation page. */
export function MyVacationCard({ vacation, full = false }: { vacation: VacationState; full?: boolean }) {
  const { dayStates, planColumns, planEntries } = useData();
  const [asking, setAsking] = useState(false);
  const today = toISODate(new Date());
  const mine = useMemo(
    () => vacation.requests.filter((r) => r.profileId === vacation.mineProfileId),
    [vacation.requests, vacation.mineProfileId],
  );
  if (!vacation.ready) return null;
  const a = vacation.mine
    ? availableDays(vacation.mine, mine, dayStates, undefined, new Date(), plannedVacation(vacation.mineProfileId, planColumns, planEntries))
    : null;
  const shown = full ? mine : mine.filter((r) => r.endDate >= today && (r.status === "pending" || r.status === "approved")).slice(0, 4);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-heading text-sm">
          <TreePalm size={16} strokeWidth={1.75} className="text-brand" /> Vacation
        </h2>
        {!full && (
          <Link href="/vacation" className="flex items-center gap-1 text-xs text-brand hover:underline">
            All requests <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {a ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={`text-3xl tabular-nums ${a.available < 0 ? "text-danger" : ""}`}>{formatDays(a.available)}</div>
            <div className="text-xs text-muted">
              days left now{a.monthly ? ` · +${formatDays(a.monthly)} each month` : ""} · {formatDays(a.balance)} on your{" "}
              {MONTH_NAMES_SHORT[vacation.mine!.month - 1]} payslip
              {a.approved ? `, ${formatDays(a.approved)} approved since` : ""}
              {a.pending ? `, ${formatDays(a.pending)} waiting` : ""}
            </div>
          </div>
          {/* Never gated on the balance: next month's credit may cover it, and
              going over is allowed once they tick that they know. */}
          <Button onClick={() => setAsking(true)}>
            Request vacation
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            No vacation balance — you&apos;re not on payroll, so there&apos;s no day limit. Nitsan approves each request.
          </p>
          <Button onClick={() => setAsking(true)}>Request vacation</Button>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-medium">{range(r)}</span>
              <span className="text-muted">
                {r.days} day{r.days === 1 ? "" : "s"}
              </span>
              <VacationStatusPill status={r.status} />
              {r.decisionNote && <span className="bidi-auto text-xs text-muted">“{r.decisionNote}”</span>}
              {r.status === "pending" && (
                <button
                  onClick={async () => {
                    if (await askConfirm("Withdraw this request?", { action: "Withdraw", danger: true })) vacation.cancel(r.id);
                  }}
                  className="ml-auto text-xs text-muted hover:text-danger"
                >
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && <VacationRequestModal vacation={vacation} onClose={() => setAsking(false)} />}
    </div>
  );
}

// ── the owner's queue ─────────────────────────────────────────────────────

export function VacationApprovals({ vacation }: { vacation: VacationState }) {
  const { profiles, dayStates, planColumns, planEntries } = useData();
  const plannedOf = (id: string) => plannedVacation(id, planColumns, planEntries);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!vacation.ready || !vacation.approver) return null;
  const name = (id: string) => profiles.find((p) => p.id === id)?.name ?? "Someone";
  const pending = vacation.requests.filter((r) => r.status === "pending").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const today = toISODate(new Date());
  const decided = vacation.requests
    .filter((r) => (r.status === "approved" || r.status === "declined") && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  async function decide(r: VacationRequest, status: "approved" | "declined") {
    setBusy(r.id);
    await vacation.decide(r.id, status, notes[r.id]);
    setBusy(null);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 font-heading text-sm">Requests to decide</h2>
      {pending.length === 0 ? (
        <p className="text-sm text-muted">Nothing waiting.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((r) => {
            const b = vacation.balances.get(r.profileId);
            const theirs = vacation.requests.filter((x) => x.profileId === r.profileId);
            const fit = b
              ? fitRequest(b, theirs, dayStates, workdays(r.startDate, r.endDate, dayStates), r.id, new Date(), plannedOf(r.profileId))
              : null;
            const lastMonth = monthName(r.endDate.slice(0, 7));
            return (
              <li key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{name(r.profileId)}</span>
                  <span>{range(r)}</span>
                  <span className="text-muted">
                    {r.days} day{r.days === 1 ? "" : "s"}
                    {fit?.ok && ` · ${formatDays(fit.leftAfter)} left at the end of ${lastMonth} after this`}
                    {!b && " · freelance — no day limit"}
                  </span>
                  {fit && !fit.ok && (
                    <span className="text-xs text-danger">
                      {formatDays(fit.short!.by)} day{fit.short!.by === 1 ? "" : "s"} short in {monthName(fit.short!.month)}
                    </span>
                  )}
                </div>
                <p className="bidi-auto mt-1 whitespace-pre-line text-sm">{r.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="A note back (optional)"
                    className="bidi-auto min-w-0 flex-1"
                  />
                  <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => decide(r, "declined")}>
                    <X size={12} className="mr-1 inline" /> Decline
                  </Button>
                  <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, "approved")}>
                    <Check size={12} className="mr-1 inline" /> Approve
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {vacation.error && <p className="mt-2 text-xs text-danger">{vacation.error}</p>}
      {decided.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-faint">Coming up</h3>
          <ul className="divide-y divide-border">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium">{name(r.profileId)}</span>
                <span>{range(r)}</span>
                <VacationStatusPill status={r.status} />
                {r.status === "approved" && (
                  <button
                    onClick={async () => {
                      if (await askConfirm(`Call off ${name(r.profileId)}'s approved vacation? The days come off the plan.`, { action: "Call it off", danger: true }))
                        vacation.cancel(r.id);
                    }}
                    className="ml-auto text-xs text-muted hover:text-danger"
                  >
                    Call off
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {vacation.balances.size > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-faint">Balances</h3>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {[...vacation.balances]
              .map(([id, b]) => ({
                id,
                b,
                a: availableDays(b, vacation.requests.filter((x) => x.profileId === id), dayStates, undefined, new Date(), plannedOf(id)),
              }))
              .filter(({ id }) => profiles.find((p) => p.id === id)?.active)
              .sort((x, y) => name(x.id).localeCompare(name(y.id)))
              .map(({ id, b, a }) => (
                <li key={id} className="flex items-baseline justify-between gap-2 border-b border-border py-1.5 text-sm">
                  <span>{name(id)}</span>
                  <span className={`tabular-nums ${a.available < 0 ? "text-danger" : ""}`}>
                    {formatDays(a.available)} {a.available === 1 ? "day" : "days"}
                    <span className="ml-1 text-xs text-faint">
                      {a.monthly ? `+${formatDays(a.monthly)}/month · ` : ""}
                      {MONTH_NAMES_SHORT[b.month - 1]} payslip
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
