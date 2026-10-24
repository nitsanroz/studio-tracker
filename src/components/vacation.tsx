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
import {
  CalendarCheck,
  Check,
  TreePalm,
  Users,
  X,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { Modal, ModalClose } from "./ui";
import { Button, Field, Input, Textarea } from "./primitives";
import { askConfirm } from "./confirm-dialog";
import { useData } from "@/lib/store";
import { MONTH_NAMES_SHORT, formatDate, toISODate } from "@/lib/format";
import { availableDays, availableIn, fitRequest, formatDays, plannedVacation, workdays, type VacationRequest } from "@/lib/vacation";
import type { VacationState } from "@/lib/use-vacation";
import { EmptyState } from "./empty-state";

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
  // ⚠️ What they'll HAVE in the month the vacation starts, before this request:
  // a day's credit for every month up to it (Nitsan, 2026-10-24 — asking for
  // February should show February's figure, not today's). Same `room` maths
  // as `fit`, so the two lines can't disagree.
  const startMonth = (from < today ? today : from).slice(0, 7);
  const inMonth = vacation.mine
    ? availableIn(vacation.mine, mine, dayStates, startMonth, undefined, new Date(), planned)
    : null;
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
        {inMonth != null && (
          <div className="rounded-xl bg-background px-3 py-2.5">
            <div className="text-sm">
              <span className={`font-medium ${inMonth < 0 ? "text-danger" : ""}`}>{formatDays(inMonth)}</span>{" "}
              day{Math.abs(inMonth) === 1 ? "" : "s"} available in {monthName(startMonth)}
              {startMonth.slice(0, 4) !== today.slice(0, 4) && ` ${startMonth.slice(0, 4)}`}
            </div>
            {/* the arithmetic, so a figure higher than the page's isn't a surprise */}
            {(vacation.mine?.accrued ?? 0) > 0 && (
              <div className="mt-0.5 text-xs text-muted">
                {`+${formatDays(vacation.mine!.accrued!)} each month until then, less what's already booked`}
              </div>
            )}
          </div>
        )}
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
              {`${shortBy} I know this is more vacation than I'll have — send it anyway.`}
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

/** Your own requests and your balance now — one calculation, shared by the card
 *  and the Vacation page's headline so the two can never disagree. `balance`
 *  is null when you have no payslip balance (not on payroll). */
export function useMyVacationBalance(vacation: VacationState) {
  const { dayStates, planColumns, planEntries } = useData();
  const mine = useMemo(
    () => vacation.requests.filter((r) => r.profileId === vacation.mineProfileId),
    [vacation.requests, vacation.mineProfileId],
  );
  const balance = useMemo(
    () =>
      vacation.ready && vacation.mine
        ? availableDays(vacation.mine, mine, dayStates, undefined, new Date(), plannedVacation(vacation.mineProfileId, planColumns, planEntries))
        : null,
    [vacation.ready, vacation.mine, vacation.mineProfileId, mine, dayStates, planColumns, planEntries],
  );
  return { mine, balance };
}

/** The Home card, and the left column of the Vacation page (`full`), where the
 * page header carries "Request vacation" instead of the card. */
export function MyVacationCard({ vacation, full = false }: { vacation: VacationState; full?: boolean }) {
  const [asking, setAsking] = useState(false);
  const today = toISODate(new Date());
  const { mine, balance: a } = useMyVacationBalance(vacation);
  if (!vacation.ready) return null;
  const shown = full ? mine : mine.filter((r) => r.endDate >= today && (r.status === "pending" || r.status === "approved")).slice(0, 4);

  return (
    <div className={`rounded-2xl border border-border bg-surface shadow-card ${full ? "p-6" : "p-4"}`}>
      <div className={`flex items-center justify-between gap-2 ${full ? "mb-3" : "mb-1.5"}`}>
        <h2 className="card-title flex items-center gap-2">
          <TreePalm size={20} strokeWidth={1.75} className="text-brand" /> {full ? "Your vacation" : "Vacation"}
        </h2>
        {!full && (
          <Link href="/vacation" className="flex items-center gap-1 text-xs text-brand hover:underline">
            All requests <StudioArrow size={15} />
          </Link>
        )}
      </div>
      {a ? (
        <div>
          {/* Home card: the days and the button share ONE row, and the "how
              it's made up" line runs under both (Nitsan, 2026-10-24 — the card
              was a tall column of number, sentence, then button). On the
              Vacation page the headline already says the days left
              (2026-10-23), so the card gives only how they are made up. */}
          {!full && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-3xl tabular-nums ${a.available < 0 ? "text-danger" : ""}`}>
                  {formatDays(a.available)}
                </span>
                <span className="text-xs text-muted">days left now</span>
              </div>
              {/* Never gated on the balance: next month's credit may cover it,
                  and going over is allowed once they tick that they know. */}
              <Button onClick={() => setAsking(true)}>Request vacation</Button>
            </div>
          )}
          <div className={`text-muted ${full ? "text-sm" : "mt-1 text-xs"}`}>
            {[
              a.monthly ? `+${formatDays(a.monthly)} each month` : null,
              `${formatDays(a.balance)} on your ${MONTH_NAMES_SHORT[vacation.mine!.month - 1]} payslip` +
                (a.approved ? `, ${formatDays(a.approved)} approved since` : "") +
                (a.pending ? `, ${formatDays(a.pending)} waiting` : ""),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            No vacation balance — you&apos;re not on payroll, so there&apos;s no day limit. Nitsan approves each request.
          </p>
          {!full && <Button onClick={() => setAsking(true)}>Request vacation</Button>}
        </div>
      )}
      {shown.length > 0 && (
        <ul className={`flex flex-col ${full ? "mt-6 gap-1" : "mt-3"}`}>
          {full && <li className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Your requests</li>}
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
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
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <h2 className="card-title mb-4 flex items-center gap-2">
        <Users size={20} strokeWidth={1.75} className="text-brand" /> The team
      </h2>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        To decide
        {pending.length > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-[11px] leading-[18px] text-white">{pending.length}</span>
        )}
      </h3>
      {pending.length === 0 ? (
        <EmptyState compact tone="success" icon={CalendarCheck} text="Nothing waiting — every request is decided." />
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
              <li key={r.id} className="rounded-xl bg-background p-4">
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
          <h3 className="mb-1 mt-7 text-xs font-medium uppercase tracking-wide text-muted">Coming up</h3>
          <ul className="flex flex-col">
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
          <h3 className="mb-2 mt-7 text-xs font-medium uppercase tracking-wide text-muted">Balances</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...vacation.balances]
              .map(([id, b]) => ({
                id,
                b,
                a: availableDays(b, vacation.requests.filter((x) => x.profileId === id), dayStates, undefined, new Date(), plannedOf(id)),
              }))
              .filter(({ id }) => profiles.find((p) => p.id === id)?.active)
              .sort((x, y) => name(x.id).localeCompare(name(y.id)))
              .map(({ id, b, a }) => (
                <li key={id} className="rounded-xl bg-background px-3.5 py-3">
                  <div className="text-[13px] font-medium">{name(id)}</div>
                  <div className={`mt-0.5 text-2xl tabular-nums ${a.available < 0 ? "text-danger" : ""}`}>
                    {formatDays(a.available)}
                    <span className="ml-1 text-sm text-muted">{a.available === 1 ? "day" : "days"}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {a.monthly ? `+${formatDays(a.monthly)}/month · ` : ""}
                    {MONTH_NAMES_SHORT[b.month - 1]} payslip
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
