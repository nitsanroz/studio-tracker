"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingLine, PageSkeleton } from "@/components/skeleton";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Contact,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ReceiptText,
  RefreshCw,
  Scale,
  Users,
  X,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { useData, useIsAdmin } from "@/lib/store";
import { ClientChip, Modal, ModalClose } from "@/components/ui";
import { formatHoursShort, parseDuration } from "@/lib/format";
import { freelancerPath } from "@/lib/freelancer-link";
import { createClient } from "@/lib/supabase/client";
import { isSafeUrl } from "@/lib/links";
import type { FreelancerDetails } from "@/lib/freelancer-details";
import {
  TermsForm,
  act,
  dayLabel,
  hrs,
  money,
  monthLabel,
  otherLine,
  shiftMonth,
  shortMonth,
  termsLine,
  type Freelancer,
} from "../shared";

// One freelancer's month, the table he sees on his own page — with every row
// still waiting for review filed right here: pick the client and task, approve
// (it becomes real tracker hours) or turn it down. His link, clients, terms and
// deliverables sit beside it. 0054–0056.

interface Row {
  id: string;
  date: string;
  hours: number;
  clientId: string | null;
  client: string | null;
  taskId: string | null;
  task: string | null;
  taskHint: string | null;
  description: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  fromSheet: boolean;
  /** One of a login's own time entries (Dima) — never reviewed here. */
  fromLog: boolean;
  /** A waiting row that changes an approved one: what is approved today. */
  before?: { date: string; hours: number; description: string; task: string | null } | null;
}
interface PickTask {
  id: string;
  title: string;
  clientId: string;
  done: boolean;
}
interface ChargeRow {
  id: string;
  date: string;
  title: string;
  amount: number;
  currency: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  fromSheet: boolean;
}
interface Data {
  period: string;
  firstPeriod: string;
  clients: { id: string; name: string }[];
  freelancer: Freelancer;
  months: {
    period: string;
    waiting: boolean;
    hours: number;
    rate: number;
    total: number;
    extras: number;
    otherExtras: { currency: string; amount: number }[];
  }[];
  logs: Row[];
  charges: ChargeRow[];
  tasks: PickTask[];
}

const thisMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" })
    .format(new Date())
    .slice(0, 7);

export default function FreelancerPage() {
  const isAdmin = useIsAdmin();
  const { profileId } = useParams<{ profileId: string }>();
  // Months already loaded, by "YYYY-MM" ("now" = the default month): a month
  // seen once opens instantly, and the one before is fetched in the background.
  const [cache, setCache] = useState<Record<string, Data>>({});
  const [period, setPeriod] = useState<string | null>(null);
  // What stays on screen while a new month loads — the month you came from.
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = period ?? "now";
  const shownKey = cache[key] ? key : prevKey;
  const data = shownKey ? (cache[shownKey] ?? null) : null;
  const loading = !cache[key];
  /**
   * The hiring dossier they were converted from (v1.90.0, 0061's
   * `candidates.profile_id`) — where their CV, portfolio and links stay.
   * ⚠️ Best effort: any error (0061 not run, or none) just shows no link.
   */
  const [candidateId, setCandidateId] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void createClient()
      .from("candidates")
      .select("id")
      .eq("profile_id", profileId)
      .limit(1)
      .then(({ data: rows, error: err }) => {
        if (alive && !err) setCandidateId((rows?.[0]?.id as string | undefined) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin, profileId]);

  const load = useCallback(
    async (k: string): Promise<Data> => {
      const q = new URLSearchParams({ freelancer: profileId, ...(k !== "now" ? { month: k } : {}) });
      const r = await fetch(`/api/admin/freelancers?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't load");
      return (await r.json()) as Data;
    },
    [profileId],
  );

  useEffect(() => {
    if (!isAdmin || cache[key]) return;
    let alive = true;
    load(key)
      .then((d) => {
        if (!alive) return;
        setCache((c) => ({ ...c, [key]: d, [d.period]: d }));
        const before = shiftMonth(d.period, -1);
        if (d.period > d.firstPeriod)
          load(before)
            .then((b) => setCache((c) => (c[before] ? c : { ...c, [before]: b })))
            .catch(() => undefined);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isAdmin, key, cache, load]);

  const go = (p: string) => {
    setPrevKey(shownKey);
    setPeriod(p);
  };
  // After an approval or edit: read this month again and drop the rest (the
  // months pane and waiting counts may have moved); the screen stays meanwhile.
  const reload = () => {
    load(key)
      .then((d) => setCache({ [key]: d, [d.period]: d }))
      .catch(() => undefined);
  };

  if (!isAdmin)
    return <p className="py-20 text-center text-sm text-muted">Admins only.</p>;
  if (error)
    return <p className="py-20 text-center text-sm text-danger">{error}</p>;
  if (!data) return <PageSkeleton />;

  const f = data.freelancer;
  const cur = f.terms.currency;
  const now = thisMonth();
  // The month asked for — named in the bar and marked in the list at once,
  // while its rows are on their way.
  const shownPeriod = period ?? data.period;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <Link
        href="/freelancers"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={15} /> Freelancers
      </Link>

      {/* Who, the month, and what it comes to — on the page itself, like every
          other page's header (2026-10-23, Page A). The bill is the brand-blue
          figure; the name is a person's, so serif. */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-serif-accent text-[44px] leading-tight">
              {f.name}
            </h1>
            <p className="text-sm text-muted">
              {termsLine(f.terms)}
              {f.hasLogin ? (
                <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-dark">
                  Hours from their own log
                </span>
              ) : (
                !f.active && (
                  <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 font-medium text-danger">
                    Link switched off
                  </span>
                )
              )}
              {candidateId && (
                <Link href={`/candidates/${candidateId}`} className="ml-2 text-brand hover:underline">
                  Their application
                </Link>
              )}
            </p>
          </div>
          <p className="text-right tabular-nums">
            <span className="font-serif-accent text-[56px] leading-none text-brand">
              {money(f.month.total, cur)}
              {otherLine(f.month.otherExtras)}
            </span>
            <span className="mt-1 block text-[13px] text-muted">
              {hrs(f.month.hours)} × {money(f.month.rate, cur)}/h ={" "}
              {money(f.month.hoursBill, cur)}
              {f.month.extras > 0 && ` + ${money(f.month.extras, cur)} extras`}
            </span>
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => go(shiftMonth(shownPeriod, -1))}
            disabled={shownPeriod <= data.firstPeriod}
            className="rounded-lg bg-surface p-2 text-muted shadow-card hover:text-foreground disabled:opacity-30 disabled:shadow-none"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-36 text-center text-sm font-medium">
            {monthLabel(shownPeriod)}
            {loading && <Loader2 size={15} className="ml-1.5 inline animate-spin text-muted" aria-label="Loading" />}
          </span>
          <button
            onClick={() => go(shiftMonth(shownPeriod, 1))}
            disabled={shownPeriod >= now}
            className="rounded-lg bg-surface p-2 text-muted shadow-card hover:text-foreground disabled:opacity-30 disabled:shadow-none"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          {shownPeriod !== now && (
            <button
              onClick={() => go(now)}
              className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface hover:text-brand"
            >
              This month
            </button>
          )}
          {/* Jump to a month with something waiting. */}
          {f.pendingMonths.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-[#855800]">
              <Clock size={13} /> Waiting for review:
              {f.pendingMonths.map((m) => (
                <button
                  key={m}
                  onClick={() => go(m)}
                  className={`rounded-full px-2 py-0.5 font-medium ${m === shownPeriod ? "bg-warning text-white" : "bg-warning/15 hover:bg-warning/25"}`}
                >
                  {shortMonth(m)}
                </button>
              ))}
            </span>
          )}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className={`relative space-y-4 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`} aria-busy={loading}>
          {loading && <LoadingLine />}
          <MonthTable data={data} onChanged={reload} />
          <Charges data={data} onChanged={reload} />
        </div>
        <div className="space-y-4">
          <Months data={data} selected={shownPeriod} onPick={go} />
          <Side f={f} clients={data.clients} onChanged={reload} />
        </div>
      </div>
    </div>
  );
}

function MonthTable({
  data,
  onChanged,
}: {
  data: Data;
  onChanged: () => void;
}) {
  // The client as the tracker's chip (opens the client's page) and the task as a
  // link to its details pane — the same as everywhere else in the app.
  const { clients, openTask } = useData();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  // ⚠️ REVIEW FIRST (2026-10-23, Page A). The logs still waiting are the only
  // thing on this page that needs doing, so they lead in a card of their own;
  // the table below is the month's record, filed and decided rows only. The
  // TOTAL still counts the waiting hours — the bill counts every hour not
  // turned down — and says so.
  const waiting = data.logs.filter((l) => l.status === "pending");
  const filed = data.logs.filter((l) => l.status !== "pending");
  const [editing, setEditing] = useState<Row | null>(null);
  const waitingHours = waiting.reduce((t, l) => t + l.hours, 0);
  return (
    <>
    {waiting.length > 0 && (
      <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="card-title flex items-center gap-2">
            <Clock size={18} strokeWidth={1.75} className="text-[#855800]" /> Waiting for review
            <span className="rounded-full bg-warning/15 px-2 text-xs text-[#855800]">{waiting.length}</span>
          </h2>
          <span className="text-[13px] text-muted">File each on a task, then approve — it becomes tracker hours</span>
        </header>
        <ul className="flex flex-col gap-3">
          {waiting.map((l) => (
            <WaitingRow key={l.id} row={l} clients={data.clients} tasks={data.tasks} onChanged={onChanged} onEdit={() => setEditing(l)} />
          ))}
        </ul>
      </section>
    )}
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <h2 className="card-title flex items-center gap-2 px-5 pt-5">
        <ReceiptText size={18} strokeWidth={1.75} className="text-brand" /> {monthLabel(data.period).split(" ")[0]}&apos;s hours
      </h2>
      <table className="mt-3 w-full min-w-[740px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="min-w-[260px] px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 font-medium">What they did</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filed.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted">
                {waiting.length ? "Nothing filed yet — see what is waiting above." : `Nothing logged in ${monthLabel(data.period)}.`}
              </td>
            </tr>
          )}
          {filed.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  {dayLabel(l.date)}
                </td>
                <td className="px-3 py-2">
                  {l.clientId && clientById.get(l.clientId) ? (
                    <ClientChip
                      client={clientById.get(l.clientId)!}
                      size="sm"
                    />
                  ) : (
                    (l.client ?? <span className="text-faint">—</span>)
                  )}
                </td>
                <td className="bidi-auto px-3 py-2">
                  {l.taskId && l.task ? (
                    <button
                      onClick={() => openTask(l.taskId!)}
                      className="text-left hover:text-brand hover:underline"
                      title="Open the task"
                    >
                      {l.task}
                    </button>
                  ) : (
                    (l.taskHint ?? <span className="text-faint">—</span>)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {hrs(l.hours)}
                </td>
                <td className="bidi-auto px-3 py-2 text-muted">
                  {l.description !== l.taskHint && l.description !== l.task
                    ? l.description
                    : ""}
                  {l.status === "rejected" && l.note && (
                    <span className="block text-xs text-danger">{l.note}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.fromSheet ? (
                    <span className="text-xs text-faint">From their sheet</span>
                  ) : l.fromLog ? (
                    <span className="text-xs text-faint">Logged</span>
                  ) : l.status === "approved" ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                        <Check size={12} /> Approved
                      </span>
                      <button
                        onClick={() => setEditing(l)}
                        className="rounded p-1 text-faint hover:bg-background hover:text-brand"
                        title="Edit this line — the tracker hours follow"
                        aria-label="Edit this line"
                      >
                        <Pencil size={14} />
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      <X size={12} /> Turned down
                    </span>
                  )}
                </td>
              </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/60 font-medium">
            <td colSpan={3} className="px-3 py-2 text-muted">
              Total{" "}
              {!data.freelancer.hasLogin && (
                <span className="font-normal text-muted">
                  (approved rows only{waitingHours > 0 ? `, plus ${hrs(waitingHours)} still waiting` : ""})
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {hrs(data.freelancer.month.hours)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
    {editing && (
      <EditLineModal
        row={editing}
        clients={data.clients}
        tasks={data.tasks}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    )}
    </>
  );
}

/** A row still waiting: his own words, and the controls to file it — the
 * client, a task of it, approve or turn down — in place. */
function WaitingRow({
  row,
  clients,
  tasks: preloaded,
  onChanged,
  onEdit,
}: {
  row: Row;
  clients: Data["clients"];
  tasks: PickTask[];
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { openTask } = useData();
  const [clientId, setClientId] = useState(row.clientId ?? "");
  const [taskId, setTaskId] = useState(row.taskId ?? "");
  const [fetched, setFetched] = useState<PickTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tasks of a client other than the one he named come from the server.
  useEffect(() => {
    if (!clientId || clientId === row.clientId) return;
    let alive = true;
    fetch(`/api/admin/freelancers?tasks=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j: { tasks?: PickTask[] }) => alive && setFetched(j.tasks ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [clientId, row.clientId]);
  const options = useMemo(
    () =>
      !clientId
        ? []
        : clientId === row.clientId
          ? preloaded.filter((t) => t.clientId === clientId)
          : (fetched ?? []),
    [clientId, row.clientId, preloaded, fetched],
  );

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(await act(body));
    setBusy(false);
    onChanged();
  }

  const select = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm";
  return (
    <li className="rounded-xl bg-background p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{dayLabel(row.date)}</span>
        <span className="text-xl font-medium tabular-nums">{hrs(row.hours)}</span>
        {row.taskHint && (
          <span className="bidi-auto text-sm">
            Their name for it: <b className="font-medium">&ldquo;{row.taskHint}&rdquo;</b>
          </span>
        )}
        {row.description !== row.taskHint && (
          <span className="bidi-auto text-sm text-muted">· {row.description}</span>
        )}
        <button
          onClick={onEdit}
          className="rounded p-1 text-faint hover:bg-surface hover:text-brand"
          title="Edit their date, hours or note"
          aria-label="Edit this line"
        >
          <Pencil size={14} />
        </button>
      </div>
      {row.before && (
        <p className="bidi-auto mt-2 rounded-lg bg-surface px-3 py-2 text-[13px] text-muted">
          <b className="font-medium text-foreground">Changed after approval.</b> Approved now:{" "}
          {dayLabel(row.before.date)} · {hrs(row.before.hours)}
          {row.before.task ? ` · ${row.before.task}` : ""} · {row.before.description}
          <span className="block text-faint">
            Approve to update those hours in the tracker, or keep the approved line as it was.
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setTaskId("");
          }}
          className={`${select} max-w-56 flex-1`}
          aria-label="Client"
        >
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex min-w-56 flex-[2] items-center gap-1">
          <select
            value={taskId}
            disabled={!clientId}
            onChange={(e) => setTaskId(e.target.value)}
            className={select}
            aria-label="Task"
          >
            <option value="">File on a task…</option>
            {options
              .filter((t) => !t.done)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            {options.some((t) => t.done) && (
              <optgroup label="Done">
                {options
                  .filter((t) => t.done)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          {taskId && (
            <button
              onClick={() => openTask(taskId)}
              className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface hover:text-brand"
              title="Open the task"
              aria-label="Open the task"
            >
              <StudioArrow size={17} up />
            </button>
          )}
        </div>
        <button
          disabled={busy || !taskId}
          onClick={() => run({ action: "approve", id: row.id, taskId })}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
        >
          <Check size={15} /> Approve
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (row.before) return void run({ action: "reject", id: row.id });
            const note = prompt("Turn this log down? Add a note for them (optional):");
            if (note !== null) void run({ action: "reject", id: row.id, note });
          }}
          className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-surface hover:text-danger"
        >
          <X size={15} /> {row.before ? "Keep the approved one" : "Turn down"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

function Charges({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (data.charges.length === 0) return null;
  async function run(body: Record<string, unknown>) {
    setBusy(body.id as string);
    await act(body);
    setBusy(null);
    onChanged();
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Extra charge</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Note</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.charges.map((c) => (
            <tr
              key={c.id}
              className={c.status === "pending" ? "bg-warning/5" : ""}
            >
              <td className="whitespace-nowrap px-3 py-2">
                {dayLabel(c.date)}
              </td>
              <td className="bidi-auto px-3 py-2">{c.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {money(c.amount, c.currency)}
              </td>
              <td className="bidi-auto px-3 py-2 text-muted">
                {c.note}
                {c.status === "rejected" && c.reviewNote && (
                  <span className="block text-xs text-danger">
                    {c.reviewNote}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {c.status === "pending" ? (
                  <div className="flex gap-1.5">
                    <button
                      disabled={busy === c.id}
                      onClick={() => run({ action: "approveCharge", id: c.id })}
                      className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      disabled={busy === c.id}
                      onClick={() => {
                        const note = prompt(
                          "Turn this charge down? Add a note for them (optional):",
                        );
                        if (note !== null)
                          void run({ action: "rejectCharge", id: c.id, note });
                      }}
                      className="flex items-center gap-1 rounded-lg bg-background px-2 py-1 text-xs text-muted hover:text-danger"
                      aria-label="Turn down"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : c.fromSheet ? (
                  <span className="text-xs text-faint">From their sheet</span>
                ) : c.status === "approved" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                    <Check size={12} /> Approved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    <X size={12} /> Turned down
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every month he has, newest first: hours, that month's rate, the bill. Click
 * one to open it; a dot marks a month with something waiting for review. A real
 * table, so every number sits under its column. */
function Months({ data, selected, onPick }: { data: Data; selected: string; onPick: (p: string) => void }) {
  const cur = data.freelancer.terms.currency;
  const total = data.months.reduce((t, m) => t + m.total, 0);
  return (
    <aside className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
      <h2 className="card-title mb-3 flex items-center gap-2">
        <ReceiptText size={18} strokeWidth={1.75} className="text-brand" /> Months
      </h2>
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full tabular-nums">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="px-1 py-1 text-left font-medium">Month</th>
              <th className="px-1 py-1 text-right font-medium">Hours</th>
              <th className="px-1 py-1 text-right font-medium">Rate</th>
              <th className="px-1 py-1 text-right font-medium">Bill</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr
                key={m.period}
                onClick={() => onPick(m.period)}
                className={`cursor-pointer ${m.period === selected ? "bg-brand-soft font-medium text-brand-dark" : "hover:bg-background"}`}
                title={
                  m.extras > 0
                    ? `Includes ${money(m.extras, cur)} extras`
                    : undefined
                }
              >
                <td className="whitespace-nowrap rounded-l-md px-1 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    {shortMonth(m.period)}
                    {m.waiting && (
                      <span
                        className="size-1.5 rounded-full bg-warning"
                        aria-label="Waiting for review"
                      />
                    )}
                  </span>
                </td>
                <td className="px-1 py-1 text-right">{hrs(m.hours)}</td>
                <td className="px-1 py-1 text-right text-muted">
                  {money(m.rate, cur)}
                </td>
                <td className="whitespace-nowrap rounded-r-md px-1 py-1 text-right">
                  {money(m.total, cur)}
                  {otherLine(m.otherExtras)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-xs text-muted">
              <td colSpan={3} className="px-1 pt-1.5">
                All months
              </td>
              <td className="px-1 pt-1.5 text-right">{money(total, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </aside>
  );
}

/** His link, clients, terms and deliverables. */
function Side({
  f,
  clients,
  onChanged,
}: {
  f: Freelancer;
  clients: Data["clients"];
  onChanged: () => void;
}) {
  const [editingClients, setEditingClients] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(f.clientIds));
  const [copied, setCopied] = useState(false);
  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${freelancerPath(f.name, f.token)}`;
  const enabled = clients.filter((c) => f.clientIds.includes(c.id));
  const btn =
    "flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1.5 text-[13px] hover:bg-track";

  return (
    <div className="space-y-4">
      <Details profileId={f.profileId} />
      {/* A login logs like any designer: no link, no client list. */}
      {!f.hasLogin && (
      <>
      <section className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
        <h2 className="card-title mb-3 flex items-center gap-2">
          <Link2 size={18} strokeWidth={1.75} className="text-brand" /> Private link
        </h2>
        <code className="block truncate rounded-lg bg-background px-3 py-2 text-xs">
          {link}
        </code>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className={btn}
          >
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
          >
            <ExternalLink size={12} /> Open their page
          </a>
          <button
            onClick={async () => {
              if (!confirm("Make a new link? The current one stops working."))
                return;
              await act({ action: "regenerate", profileId: f.profileId });
              onChanged();
            }}
            className={btn}
          >
            <RefreshCw size={12} /> New link
          </button>
          <button
            onClick={async () => {
              await act({
                action: "active",
                profileId: f.profileId,
                active: !f.active,
              });
              onChanged();
            }}
            className={btn}
          >
            {f.active ? "Switch off" : "Switch on"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
        <h2 className="card-title mb-3 flex items-center gap-2">
          <Users size={18} strokeWidth={1.75} className="text-brand" /> Clients they can log against
          {!editingClients && (
            <button
              onClick={() => setEditingClients(true)}
              className="ml-auto text-[13px] font-normal text-brand hover:underline"
            >
              Edit
            </button>
          )}
        </h2>
        {!editingClients ? (
          <p>
            {enabled.length ? (
              enabled.map((x) => x.name).join(" · ")
            ) : (
              <span className="text-muted">None yet</span>
            )}
          </p>
        ) : (
          <div>
            <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-border p-2">
              {clients.map((cl) => (
                <label key={cl.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.has(cl.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(cl.id);
                      else next.delete(cl.id);
                      setPicked(next);
                    }}
                  />
                  <span className="truncate">{cl.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  await act({
                    action: "clients",
                    profileId: f.profileId,
                    clientIds: [...picked],
                  });
                  setEditingClients(false);
                  onChanged();
                }}
                className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setPicked(new Set(f.clientIds));
                  setEditingClients(false);
                }}
                className="rounded-lg bg-background px-3 py-1 text-xs text-brand hover:bg-brand-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          Approving a row on a new client opens it for them.
        </p>
      </section>
      </>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
        <h2 className="card-title mb-3 flex items-center gap-2">
          <Scale size={18} strokeWidth={1.75} className="text-brand" /> Terms
          {!editingTerms && (
            <button
              onClick={() => setEditingTerms(true)}
              className="ml-auto text-[13px] font-normal text-brand hover:underline"
            >
              Edit
            </button>
          )}
        </h2>
        {editingTerms ? (
          <TermsForm
            initial={f.terms}
            submitLabel="Save terms"
            onCancel={() => setEditingTerms(false)}
            onSubmit={async (t) => {
              const err = await act({
                action: "terms",
                profileId: f.profileId,
                ...t,
              });
              if (!err) {
                setEditingTerms(false);
                onChanged();
              }
              return err;
            }}
          />
        ) : (
          <p>
            {termsLine(f.terms)}.{" "}
            {f.hasLogin ? "The bill counts every hour in their log." : "The bill counts every hour not turned down."}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
        <h2 className="card-title mb-3 flex items-center gap-2">
          <FolderOpen size={18} strokeWidth={1.75} className="text-brand" /> Deliverables &amp; folders
        </h2>
        {f.deliverables.length === 0 ? (
          <p className="text-faint">None yet</p>
        ) : (
          <ul className="space-y-1">
            {f.deliverables.map((d) => (
              <li key={d.url + d.date} className="flex items-start gap-2">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-start gap-1.5 text-brand hover:underline"
                >
                  <ExternalLink size={12} className="mt-1 shrink-0" />{" "}
                  <span className="bidi-auto break-words">{d.title}</span>
                </a>
                <span className="shrink-0 text-xs text-faint">
                  {dayLabel(d.date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const EMPTY: FreelancerDetails = { email: null, phone: null, website: null, location: null, notes: null };

/**
 * Their details (v1.91.0, Nitsan 2026-11-05: "so it's organized"): email and
 * phone are their HR details (a candidate's conversion fills them; finance's
 * person page shows them), website / location / notes are 0063's columns on
 * their freelancer row. Admin-only; never reaches their /log page. Loaded on
 * its own, so a month switch doesn't fetch it again.
 */
function Details({ profileId }: { profileId: string }) {
  const [d, setD] = useState<FreelancerDetails | null>(null);
  /** false = 0063 not run: only email and phone can be kept. */
  const [extra, setExtra] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FreelancerDetails>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/freelancers?details=${encodeURIComponent(profileId)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error))))
      .then((j: { details: FreelancerDetails; extra: boolean }) => {
        if (!alive) return;
        setD(j.details);
        setExtra(j.extra);
      })
      .catch(() => alive && setD(EMPTY));
    return () => {
      alive = false;
    };
  }, [profileId, version]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/admin/freelancers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "details", profileId, ...form }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; warning?: string };
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Couldn't save");
    if (j.warning) setError(j.warning);
    setEditing(false);
    setVersion((v) => v + 1);
  };

  const field = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
  const input = (k: keyof FreelancerDetails, label: string, type = "text", placeholder = "") => (
    <label className="block text-xs text-muted">
      {label}
      <input
        type={type}
        value={form[k] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className={`${field} mt-1 text-foreground`}
      />
    </label>
  );
  const line = (Icon: typeof Mail, value: React.ReactNode) => (
    <p className="flex min-w-0 items-start gap-2">
      <Icon size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
  const nothing = d && !d.email && !d.phone && !d.website && !d.location && !d.notes;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 text-sm shadow-card">
      <h2 className="card-title mb-3 flex items-center gap-2">
        <Contact size={18} strokeWidth={1.75} className="text-brand" /> Details
        {!editing && d && (
          <button
            onClick={() => {
              setForm(d);
              setError(null);
              setEditing(true);
            }}
            className="ml-auto text-[13px] font-normal text-brand hover:underline"
          >
            Edit
          </button>
        )}
      </h2>
      {!d ? (
        <LoadingLine />
      ) : editing ? (
        <div className="space-y-2">
          {input("email", "Email", "email")}
          {input("phone", "Phone", "tel")}
          {extra && (
            <>
              {input("website", "Website / portfolio", "url", "behance.net/…")}
              {input("location", "Where they work from", "text", "City, country")}
              <label className="block text-xs text-muted">
                Notes
                <textarea
                  value={form.notes ?? ""}
                  rows={3}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="How they invoice, time zone…"
                  className={`${field} bidi-auto mt-1 text-foreground`}
                />
              </label>
            </>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy}
              onClick={() => void save()}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save details"}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : nothing ? (
        <p className="text-faint">None yet — add their email, phone and the rest.</p>
      ) : (
        <div className="space-y-1.5">
          {d.email && line(Mail, <a href={`mailto:${d.email}`} className="text-brand hover:underline">{d.email}</a>)}
          {d.phone && line(Phone, <a href={`tel:${d.phone.replace(/[^\d+]/g, "")}`} className="text-brand hover:underline">{d.phone}</a>)}
          {d.website &&
            isSafeUrl(d.website) &&
            line(
              Globe,
              <a href={d.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                {d.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>,
            )}
          {d.location && line(MapPin, <span className="bidi-auto">{d.location}</span>)}
          {d.notes && <p className="bidi-auto whitespace-pre-wrap pt-1 text-muted">{d.notes}</p>}
        </div>
      )}
      {!editing && error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {!extra && !editing && (
        <p className="mt-2 text-[11px] text-faint">Website, location and notes need migration 0063.</p>
      )}
    </section>
  );
}

/**
 * The admin's edit of one freelancer line — date, hours, task, note — approved
 * lines included (v1.89.0). The server moves the tracker entry by the
 * difference, so a Keys write-down on it survives; the tracker's own popup
 * won't edit these, so the two can't drift apart.
 */
function EditLineModal({
  row,
  clients,
  tasks: preloaded,
  onClose,
  onSaved,
}: {
  row: Row;
  clients: Data["clients"];
  tasks: PickTask[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(row.date);
  const [duration, setDuration] = useState(formatHoursShort(Math.round(row.hours * 60)));
  const [description, setDescription] = useState(row.description);
  const [clientId, setClientId] = useState(row.clientId ?? "");
  const [taskId, setTaskId] = useState(row.taskId ?? "");
  const [fetched, setFetched] = useState<PickTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    fetch(`/api/admin/freelancers?tasks=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j: { tasks?: PickTask[] }) => alive && setFetched(j.tasks ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [clientId]);
  const options = (fetched ?? preloaded.filter((t) => t.clientId === clientId)).filter(
    (t) => !t.done || t.id === taskId,
  );
  // The line's own task may be done and so missing from a fresh list — keep it.
  if (row.taskId && row.task && clientId === row.clientId && !options.some((t) => t.id === row.taskId)) {
    options.unshift({ id: row.taskId, title: row.task, clientId, done: true });
  }
  const minutes = parseDuration(duration);
  const approved = row.status === "approved";
  const ready = !!date && !!minutes && minutes > 0 && description.trim().length > 0 && (!approved || !!taskId);

  async function save() {
    if (!ready) return;
    setBusy(true);
    const err = await act({ action: "editLog", id: row.id, date, minutes, description: description.trim(), taskId });
    setBusy(false);
    if (err) setError(err);
    else onSaved();
  }

  const field = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm";
  return (
    <Modal onClose={onClose} width="md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm">Edit their line</h3>
        <ModalClose onClose={onClose} />
      </div>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-muted">Date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={field} />
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-muted">Hours</span>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              title="1.5, 1.5h, 1:30 and 90m all work"
              className={`${field} ${duration && minutes == null ? "border-danger" : ""}`}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Client</span>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setTaskId("");
              setFetched(null);
            }}
            className={field}
          >
            <option value="">Client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Task</span>
          <select value={taskId} disabled={!clientId} onChange={(e) => setTaskId(e.target.value)} className={field}>
            <option value="">{approved ? "Pick a task…" : "Not filed yet"}</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.done ? " (done)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">What they did</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="bidi-auto w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        {approved && (
          <p className="text-xs text-muted">
            Approved — saving updates its tracker hours too. A Keys write-down on them stays: only the
            difference in hours is applied.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-background">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!ready || busy}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
