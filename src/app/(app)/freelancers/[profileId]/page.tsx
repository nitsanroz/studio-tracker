"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { useIsAdmin } from "@/lib/store";
import { freelancerPath } from "@/lib/freelancer-link";
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

const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()).slice(0, 7);

export default function FreelancerPage() {
  const isAdmin = useIsAdmin();
  const { profileId } = useParams<{ profileId: string }>();
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const q = new URLSearchParams({ freelancer: profileId, ...(period ? { month: period } : {}) });
    fetch(`/api/admin/freelancers?${q}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as Data) : Promise.reject(new Error((await r.json()).error))))
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isAdmin, profileId, period, version]);

  if (!isAdmin) return <p className="py-20 text-center text-sm text-muted">Admins only.</p>;
  if (error) return <p className="py-20 text-center text-sm text-danger">{error}</p>;
  if (!data) return <p className="py-20 text-center text-sm text-muted">Loading…</p>;

  const f = data.freelancer;
  const cur = f.terms.currency;
  const now = thisMonth();

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Link href="/freelancers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={15} /> Freelancers
      </Link>

      {/* Hero: who, the month, and what it comes to. */}
      <section className="rounded-2xl bg-brand px-5 py-4 text-white">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-serif-accent text-[32px] leading-10">{f.name}</h1>
            <p className="text-xs text-white/75">
              {termsLine(f.terms)}
              {!f.active && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 font-medium text-white">Link switched off</span>}
            </p>
          </div>
          <p className="text-right tabular-nums">
            <span className="text-3xl font-semibold">
              {money(f.month.total, cur)}
              {otherLine(f.month.otherExtras)}
            </span>
            <span className="block text-sm text-white/80">
              {hrs(f.month.hours)} × {money(f.month.rate, cur)}/h = {money(f.month.hoursBill, cur)}
              {f.month.extras > 0 && ` + ${money(f.month.extras, cur)} extras`}
            </span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/20 pt-3">
          <button
            onClick={() => setPeriod(shiftMonth(data.period, -1))}
            disabled={data.period <= data.firstPeriod}
            className="rounded-md p-1 hover:bg-white/15 disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-36 text-center font-semibold">{monthLabel(data.period)}</span>
          <button
            onClick={() => setPeriod(shiftMonth(data.period, 1))}
            disabled={data.period >= now}
            className="rounded-md p-1 hover:bg-white/15 disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          {data.period !== now && (
            <button onClick={() => setPeriod(now)} className="rounded-md px-2 py-1 text-xs hover:bg-white/15">
              This month
            </button>
          )}
          {/* Jump to a month with something waiting. */}
          {f.pendingMonths.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
              <Clock size={13} /> Waiting for review:
              {f.pendingMonths.map((m) => (
                <button
                  key={m}
                  onClick={() => setPeriod(m)}
                  className={`rounded-full px-2 py-0.5 font-medium ${m === data.period ? "bg-white text-brand" : "bg-white/20 hover:bg-white/30"}`}
                >
                  {shortMonth(m)}
                </button>
              ))}
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <MonthTable data={data} onChanged={reload} />
          <Charges data={data} onChanged={reload} />
        </div>
        <div className="space-y-4">
          <Months data={data} onPick={setPeriod} />
          <Side f={f} clients={data.clients} onChanged={reload} />
        </div>
      </div>
    </div>
  );
}

function MonthTable({ data, onChanged }: { data: Data; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 font-medium">What he did</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.logs.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted">
                Nothing logged in {monthLabel(data.period)}.
              </td>
            </tr>
          )}
          {data.logs.map((l) =>
            l.status === "pending" ? (
              <WaitingRow key={l.id} row={l} clients={data.clients} tasks={data.tasks} onChanged={onChanged} />
            ) : (
              <tr key={l.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">{dayLabel(l.date)}</td>
                <td className="px-3 py-2">{l.client ?? <span className="text-faint">—</span>}</td>
                <td className="bidi-auto px-3 py-2">{l.task ?? l.taskHint ?? <span className="text-faint">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{hrs(l.hours)}</td>
                <td className="bidi-auto px-3 py-2 text-muted">
                  {l.description !== l.taskHint && l.description !== l.task ? l.description : ""}
                  {l.status === "rejected" && l.note && <span className="block text-xs text-danger">{l.note}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.fromSheet ? (
                    <span className="text-xs text-faint">From his sheet</span>
                  ) : l.status === "approved" ? (
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
            ),
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/60 font-medium">
            <td colSpan={3} className="px-3 py-2 text-muted">
              Total <span className="font-normal text-faint">(not counting turned-down rows)</span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{hrs(data.freelancer.month.hours)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** A row still waiting: his own words, and the controls to file it — the
 * client, a task of it, approve or turn down — in place. */
function WaitingRow({ row, clients, tasks: preloaded, onChanged }: { row: Row; clients: Data["clients"]; tasks: PickTask[]; onChanged: () => void }) {
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
    () => (!clientId ? [] : clientId === row.clientId ? preloaded.filter((t) => t.clientId === clientId) : (fetched ?? [])),
    [clientId, row.clientId, preloaded, fetched],
  );

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(await act(body));
    setBusy(false);
    onChanged();
  }

  const select = "w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm";
  return (
    <tr className="bg-warning/5 align-top">
      <td className="whitespace-nowrap px-3 py-2">{dayLabel(row.date)}</td>
      <td className="px-3 py-2">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setTaskId("");
          }}
          className={select}
        >
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        {row.taskHint && <p className="bidi-auto mb-1 text-xs text-muted">His name: &ldquo;{row.taskHint}&rdquo;</p>}
        <select value={taskId} disabled={!clientId} onChange={(e) => setTaskId(e.target.value)} className={select}>
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
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{hrs(row.hours)}</td>
      <td className="bidi-auto px-3 py-2 text-muted">
        {row.description !== row.taskHint ? row.description : ""}
        {error && <span className="block text-xs text-danger">{error}</span>}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5">
          <button
            disabled={busy || !taskId}
            onClick={() => run({ action: "approve", id: row.id, taskId })}
            className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          >
            <Check size={13} /> Approve
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const note = prompt("Turn this log down? Add a note for him (optional):");
              if (note !== null) void run({ action: "reject", id: row.id, note });
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-danger"
            aria-label="Turn down"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Extra charges on his month — another freelancer he brought in, a purchase. */
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
            <tr key={c.id} className={c.status === "pending" ? "bg-warning/5" : ""}>
              <td className="whitespace-nowrap px-3 py-2">{dayLabel(c.date)}</td>
              <td className="bidi-auto px-3 py-2">{c.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(c.amount, c.currency)}</td>
              <td className="bidi-auto px-3 py-2 text-muted">
                {c.note}
                {c.status === "rejected" && c.reviewNote && <span className="block text-xs text-danger">{c.reviewNote}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {c.status === "pending" ? (
                  <div className="flex gap-1.5">
                    <button
                      disabled={busy === c.id}
                      onClick={() => run({ action: "approveCharge", id: c.id })}
                      className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      disabled={busy === c.id}
                      onClick={() => {
                        const note = prompt("Turn this charge down? Add a note for him (optional):");
                        if (note !== null) void run({ action: "rejectCharge", id: c.id, note });
                      }}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-danger"
                      aria-label="Turn down"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : c.fromSheet ? (
                  <span className="text-xs text-faint">From his sheet</span>
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
 * one to open it; a dot marks a month with something waiting for review. */
function Months({ data, onPick }: { data: Data; onPick: (p: string) => void }) {
  const cur = data.freelancer.terms.currency;
  const total = data.months.reduce((t, m) => t + m.total, 0);
  return (
    <aside className="rounded-2xl border border-border bg-surface p-3 text-sm shadow-card">
      <h2 className="mb-1.5 px-1 font-medium">Months</h2>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 px-1 pb-1 text-[11px] uppercase tracking-wide text-faint">
        <span>Month</span>
        <span className="text-right">Hours</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Bill</span>
      </div>
      <ul className="max-h-[420px] overflow-auto">
        {data.months.map((m) => (
          <li key={m.period}>
            <button
              onClick={() => onPick(m.period)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 rounded-md px-1 py-1 text-left tabular-nums ${
                m.period === data.period ? "bg-brand-soft font-medium text-brand-dark" : "hover:bg-background"
              }`}
              title={m.extras > 0 ? `Includes ${money(m.extras, cur)} extras` : undefined}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                {shortMonth(m.period)}
                {m.waiting && <span className="size-1.5 rounded-full bg-warning" aria-label="Waiting for review" />}
              </span>
              <span className="text-right">{hrs(m.hours)}</span>
              <span className="text-right text-muted">{money(m.rate, cur).replace(".00", "")}</span>
              <span className="text-right">
                {money(m.total, cur)}
                {otherLine(m.otherExtras)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex justify-between border-t border-border px-1 pt-1.5 text-xs text-muted">
        <span>All months</span>
        <span className="tabular-nums">{money(total, cur)}</span>
      </div>
    </aside>
  );
}

/** His link, clients, terms and deliverables. */
function Side({ f, clients, onChanged }: { f: Freelancer; clients: Data["clients"]; onChanged: () => void }) {
  const [editingClients, setEditingClients] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(f.clientIds));
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}${freelancerPath(f.name, f.token)}`;
  const enabled = clients.filter((c) => f.clientIds.includes(c.id));
  const btn = "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background";

  return (
    <aside className="h-fit space-y-5 rounded-2xl border border-border bg-surface p-4 text-sm shadow-card">
      <div>
        <h2 className="mb-1.5 font-medium">His private link</h2>
        <code className="block truncate rounded bg-background px-2 py-1 text-xs">{link}</code>
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
          <a href={link} target="_blank" rel="noopener noreferrer" className={btn}>
            <ExternalLink size={12} /> Open his page
          </a>
          <button
            onClick={async () => {
              if (!confirm("Make a new link? The current one stops working.")) return;
              await act({ action: "regenerate", profileId: f.profileId });
              onChanged();
            }}
            className={btn}
          >
            <RefreshCw size={12} /> New link
          </button>
          <button
            onClick={async () => {
              await act({ action: "active", profileId: f.profileId, active: !f.active });
              onChanged();
            }}
            className={btn}
          >
            {f.active ? "Switch off" : "Switch on"}
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-1 flex items-center gap-2 font-medium">
          Clients he can log against
          {!editingClients && (
            <button onClick={() => setEditingClients(true)} className="text-xs font-normal text-brand hover:underline">
              Edit
            </button>
          )}
        </h2>
        {!editingClients ? (
          <p>{enabled.length ? enabled.map((x) => x.name).join(" · ") : <span className="text-muted">None yet</span>}</p>
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
                  await act({ action: "clients", profileId: f.profileId, clientIds: [...picked] });
                  setEditingClients(false);
                  onChanged();
                }}
                className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setPicked(new Set(f.clientIds));
                  setEditingClients(false);
                }}
                className="rounded-md border border-border px-3 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="mt-1 text-xs text-faint">Approving a row on a new client opens it for him.</p>
      </div>

      <div>
        <h2 className="mb-1 flex items-center gap-2 font-medium">
          Terms
          {!editingTerms && (
            <button onClick={() => setEditingTerms(true)} className="text-xs font-normal text-brand hover:underline">
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
              const err = await act({ action: "terms", profileId: f.profileId, ...t });
              if (!err) {
                setEditingTerms(false);
                onChanged();
              }
              return err;
            }}
          />
        ) : (
          <p className="text-muted">{termsLine(f.terms)}. The bill counts every hour not turned down.</p>
        )}
      </div>

      <div>
        <h2 className="mb-1 font-medium">His deliverables &amp; folders</h2>
        {f.deliverables.length === 0 ? (
          <p className="text-faint">None yet</p>
        ) : (
          <ul className="space-y-1">
            {f.deliverables.map((d) => (
              <li key={d.url + d.date} className="flex items-start gap-2">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-start gap-1.5 text-brand hover:underline">
                  <ExternalLink size={12} className="mt-1 shrink-0" /> <span className="bidi-auto break-words">{d.title}</span>
                </a>
                <span className="shrink-0 text-xs text-faint">{dayLabel(d.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
