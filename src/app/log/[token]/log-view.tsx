"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { ClientAvatar } from "@/components/client-avatar";

// A freelancer's page (0054–0057): his hours as a table, a month at a time,
// like the sheet he billed from; his extra charges below; a floating box to add
// either; and a pane of links to his deliverables.
// ⚠️ Review is INTERNAL to the studio (Nitsan): no status shows here, turned-down
// rows don't either (the server leaves them out; they're out of his bill) — he
// only sees whether a row is still his to change: his own, not yet filed, and
// in the current month. Filed lines are tracker hours — history — and stay put.

// ⚠️ 16px text in every input on a phone: iOS Safari zooms the page when a
// focused input's text is smaller (same rule as the intake form).
const field =
  "w-full rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-base outline-none focus:border-brand bidi-auto md:text-sm";

interface ClientInfo {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  iconUrl: string | null;
}
interface Log {
  id: string;
  date: string;
  hours: number;
  client: ClientInfo | null;
  task: string | null;
  taskHint: string | null;
  description: string;
  editable: boolean;
  clientId: string | null;
  taskId: string | null;
}
interface ChargeRow {
  id: string;
  date: string;
  title: string;
  amount: number;
  currency: string;
  note: string | null;
  editable: boolean;
}
/** A line of his being edited in the floating box. */
type Editing = { kind: "hours"; log: Log } | { kind: "charge"; charge: ChargeRow } | null;
interface Data {
  name: string;
  today: string;
  earliest: string;
  period: string;
  firstPeriod: string;
  clients: ClientInfo[];
  tasks: { id: string; title: string; clientId: string }[];
  summary: {
    hours: number;
    rate: number;
    hoursBill: number;
    extras: number;
    otherExtras: { currency: string; amount: number }[];
    total: number;
    currency: string;
  };
  terms: { rateHigh: number; rateLow: number; hoursLow: number; hoursHigh: number };
  months: { period: string; hours: number; rate: number; total: number; extras: number; otherExtras: { currency: string; amount: number }[] }[];
  logs: Log[];
  charges: ChargeRow[];
  deliverables: { id: string; title: string; url: string; date: string }[];
}

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", ILS: "₪" };
const money = (n: number, c: string) =>
  `${SYMBOL[c] ?? `${c} `}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => `${Number(n.toFixed(2)).toLocaleString("en-US")}h`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const shift = (p: string, by: number) => {
  const i = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** The tracker's client chip (components/ui.tsx `ClientChip`), without its link —
 * his page can't open a client. */
function Chip({ client }: { client: ClientInfo }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-0.5 pr-2 text-xs font-medium">
      <ClientAvatar client={client} size={16} radius="full" />
      {client.name}
    </span>
  );
}

export function FreelancerLogView({ token }: { token: string }) {
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped after every change to read the month again.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [editing, setEditing] = useState<Editing>(null);
  const api = `/api/log/${encodeURIComponent(token)}`;
  const startEdit = (e: Editing) => {
    setEditing(e);
    // The box is pinned to the bottom; bring it into view on a long month.
    requestAnimationFrame(() => document.getElementById("composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  useEffect(() => {
    let alive = true;
    fetch(period ? `${api}?month=${period}` : api, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (ok) setData(j as Data);
        else setFailed(j.error ?? "This link isn't active.");
      })
      .catch(() => alive && setFailed("Couldn't load — check your connection and refresh."));
    return () => {
      alive = false;
    };
  }, [api, period, version]);

  if (failed)
    return (
      <Shell>
        <p className="py-16 text-center text-muted">{failed}</p>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <p className="py-16 text-center text-muted">Loading…</p>
      </Shell>
    );

  const cur = data.summary.currency;
  const thisMonth = data.today.slice(0, 7);
  // He writes to the current month only — past months are history.
  const canLog = data.period === thisMonth;

  return (
    <Shell>
      {/* One header line: who, his terms, and the "&more" mark top right (the
          sidebar's short logo — the full wordmark cost a row of height). */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif-accent text-[30px] leading-9">Hi {data.name}</h1>
          <p className="text-xs text-muted">
            Your rate: {money(data.terms.rateHigh, cur)}/h up to {data.terms.hoursLow}h a month, sliding to{" "}
            {money(data.terms.rateLow, cur)}/h from {data.terms.hoursHigh}h
          </p>
        </div>
        <span className="brand-ampmore w-20 bg-brand" aria-label="Studio&more" />
      </div>

      {/* The month: step through it, and what it comes to. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-white">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPeriod(shift(data.period, -1))}
            disabled={data.period <= data.firstPeriod}
            className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="min-w-40 text-center text-lg font-semibold">{monthLabel(data.period)}</p>
          <button
            onClick={() => setPeriod(shift(data.period, 1))}
            disabled={data.period >= thisMonth}
            className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          {data.period !== thisMonth && (
            <button onClick={() => setPeriod(thisMonth)} className="ml-1 rounded-md px-2 py-1 text-xs hover:bg-white/15">
              This month
            </button>
          )}
        </div>
        <p className="text-right tabular-nums">
          <span className="text-2xl font-semibold">{hrs(data.summary.hours)}</span>
          <span className="text-white/80"> × {money(data.summary.rate, cur)}/h</span>
          {data.summary.extras > 0 && <span className="text-white/80"> + {money(data.summary.extras, cur)} extras</span>}
          <span className="text-white/80"> = </span>
          <span className="text-2xl font-semibold">{money(data.summary.total, cur)}</span>
          {data.summary.otherExtras.map((o) => (
            <span key={o.currency} className="text-white/80">
              {" "}
              + {money(o.amount, o.currency)}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <HoursTable data={data} api={api} onChanged={reload} onEdit={(log) => startEdit({ kind: "hours", log })} />
          {data.charges.length > 0 && (
            <ChargesTable data={data} api={api} onChanged={reload} onEdit={(charge) => startEdit({ kind: "charge", charge })} />
          )}
          {canLog && (
            <Composer
              key={editing ? (editing.kind === "hours" ? editing.log.id : editing.charge.id) : "new"}
              data={data}
              api={api}
              editing={editing}
              onDone={() => {
                setEditing(null);
                reload();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
        <div className="space-y-4">
          <Months data={data} onPick={setPeriod} />
          <Deliverables data={data} api={api} onChanged={reload} />
        </div>
      </div>
    </Shell>
  );
}

/** Edit / delete on a row that's still his to change (shown on hover). */
function RowActions({ label, onEdit, onRemove }: { label: string; onEdit: () => void; onRemove: () => Promise<void> }) {
  return (
    <div className="flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      <button onClick={onEdit} className="text-faint hover:text-brand" aria-label={`Edit ${label}`} title="Edit">
        <Pencil size={14} />
      </button>
      <button
        onClick={async () => {
          if (!confirm(`Delete this ${label}?`)) return;
          await onRemove();
        }}
        className="text-faint hover:text-danger"
        aria-label={`Delete ${label}`}
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function HoursTable({ data, api, onChanged, onEdit }: { data: Data; api: string; onChanged: () => void; onEdit: (l: Log) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="w-28 px-3 py-2 font-medium">Date</th>
            <th className="w-40 px-3 py-2 font-medium">Client</th>
            <th className="w-56 px-3 py-2 font-medium">Task</th>
            <th className="w-20 px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 font-medium">What I did</th>
            <th className="w-14" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.logs.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted">
                No hours in {monthLabel(data.period)}.
              </td>
            </tr>
          )}
          {data.logs.map((l) => (
            <tr key={l.id} className="group align-top">
              <td className="whitespace-nowrap px-3 py-2">{dayLabel(l.date)}</td>
              <td className="px-3 py-2">{l.client ? <Chip client={l.client} /> : <span className="text-faint">—</span>}</td>
              <td className="bidi-auto px-3 py-2">{l.task ?? l.taskHint ?? <span className="text-faint">—</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{hrs(l.hours)}</td>
              <td className="bidi-auto px-3 py-2 text-muted">
                {l.description !== l.taskHint && l.description !== l.task ? l.description : ""}
              </td>
              <td className="px-2 py-2">
                {l.editable && (
                  <RowActions
                    label="line"
                    onEdit={() => onEdit(l)}
                    onRemove={async () => {
                      await fetch(`${api}?id=${encodeURIComponent(l.id)}`, { method: "DELETE" });
                      onChanged();
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/60 font-medium">
            <td colSpan={3} className="px-3 py-2 text-muted">
              Total hours
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{hrs(data.summary.hours)}</td>
            <td colSpan={2} className="px-3 py-2 text-right tabular-nums text-muted">
              {money(data.summary.hoursBill, data.summary.currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Extra charges on his month — another freelancer he brought in, a purchase. */
function ChargesTable({ data, api, onChanged, onEdit }: { data: Data; api: string; onChanged: () => void; onEdit: (c: ChargeRow) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="w-28 px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Extra charge</th>
            <th className="w-32 px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Note</th>
            <th className="w-14" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.charges.map((c) => (
            <tr key={c.id} className="group">
              <td className="whitespace-nowrap px-3 py-2">{dayLabel(c.date)}</td>
              <td className="bidi-auto px-3 py-2">{c.title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(c.amount, c.currency)}</td>
              <td className="bidi-auto px-3 py-2 text-muted">{c.note}</td>
              <td className="px-2 py-2">
                {c.editable && (
                  <RowActions
                    label="charge"
                    onEdit={() => onEdit(c)}
                    onRemove={async () => {
                      await fetch(`${api}?charge=${encodeURIComponent(c.id)}`, { method: "DELETE" });
                      onChanged();
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/60 font-medium">
            <td colSpan={2} className="px-3 py-2 text-muted">
              Total extras
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{money(data.summary.extras, data.summary.currency)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The floating box that adds a line — hours or an extra charge. Separate from
 * the tables and pinned to the bottom of the screen while he scrolls. */
function Composer({
  data,
  api,
  editing,
  onDone,
  onCancel,
}: {
  data: Data;
  api: string;
  editing: Editing;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Editing fills the box from the line; otherwise it starts blank, dated today.
  const log = editing?.kind === "hours" ? editing.log : null;
  const charge = editing?.kind === "charge" ? editing.charge : null;
  const [kind, setKind] = useState<"hours" | "charge">(charge ? "charge" : "hours");
  const [date, setDate] = useState(log?.date ?? charge?.date ?? data.today);
  const [clientId, setClientId] = useState(log ? (log.clientId ?? "") : data.clients.length === 1 ? data.clients[0].id : "");
  const [task, setTask] = useState(log ? (log.task ?? log.taskHint ?? "") : (charge?.title ?? ""));
  const [hours, setHours] = useState(log ? String(log.hours) : "");
  const [text, setText] = useState(log ? (log.description !== (log.task ?? log.taskHint) ? log.description : "") : (charge?.note ?? ""));
  const [amount, setAmount] = useState(charge ? String(charge.amount) : "");
  const [currency, setCurrency] = useState(charge?.currency ?? data.summary.currency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMemo(() => (clientId ? data.tasks.filter((t) => t.clientId === clientId) : data.tasks), [data.tasks, clientId]);

  async function submit() {
    setError(null);
    let body: Record<string, unknown>;
    if (kind === "hours") {
      const h = Number(hours.replace(",", "."));
      if (!(h > 0 && h <= 24)) return setError("Enter the hours, e.g. 3.5");
      if (!text.trim() && !task.trim()) return setError("Say what you worked on.");
      const known = tasks.find((t) => t.title.toLowerCase() === task.trim().toLowerCase());
      body = {
        date,
        minutes: Math.round(h * 60),
        clientId: clientId || known?.clientId || null,
        taskId: known?.id ?? null,
        taskHint: known ? null : task,
        description: text.trim() || task.trim(),
      };
    } else {
      const a = Number(amount.replace(",", "."));
      if (!task.trim()) return setError("Say what the charge is for.");
      if (!(a > 0)) return setError("Enter the amount, e.g. 150");
      body = { type: "charge", date, title: task, amount: a, currency, note: text };
    }
    setSaving(true);
    const id = log?.id ?? charge?.id;
    const r = await fetch(api, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { ...body, id, type: kind === "charge" ? "charge" : "hours" } : body),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(j.error ?? "Couldn't save — try again.");
    setTask("");
    setHours("");
    setText("");
    setAmount("");
    onDone();
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      id="composer"
      className={`sticky bottom-4 z-10 rounded-2xl border bg-surface p-4 shadow-[0_12px_40px_rgba(6,17,47,0.18)] ${
        editing ? "border-brand" : "border-brand/30"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <p className="text-sm font-semibold">{editing ? "Editing a line" : "Add a line"}</p>
        {editing && (
          <button onClick={onCancel} className="text-xs text-muted hover:text-foreground">
            Cancel
          </button>
        )}
        <div className={`flex rounded-lg bg-background p-0.5 text-xs font-medium ${editing ? "hidden" : ""}`}>
          {(["hours", "charge"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 ${kind === k ? "bg-surface text-brand shadow-card" : "text-muted hover:text-foreground"}`}
            >
              {k === "hours" ? "Hours" : "Extra charge"}
            </button>
          ))}
        </div>
      </div>
      {kind === "hours" ? (
        <div className="grid grid-cols-[150px_170px_minmax(0,1fr)_80px_minmax(0,1.3fr)_auto] items-start gap-2">
          <input type="date" value={date} min={data.earliest} max={data.today} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field} aria-label="Client">
            <option value="">Client — not sure</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div>
            <input list="his-tasks" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onEnter} placeholder="Task" maxLength={120} className={field} />
            <datalist id="his-tasks">
              {tasks.map((t) => (
                <option key={t.id} value={t.title} />
              ))}
            </datalist>
          </div>
          <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} onKeyDown={onEnter} placeholder="Hours" className={`${field} text-right`} />
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onEnter} placeholder="What you did" maxLength={600} className={field} />
          <AddButton saving={saving} label={editing ? "Save" : "Add"} onClick={() => void submit()} />
        </div>
      ) : (
        <div className="grid grid-cols-[150px_minmax(0,1.3fr)_110px_70px_minmax(0,1fr)_auto] items-start gap-2">
          <input type="date" value={date} min={data.earliest} max={data.today} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
          <input value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onEnter} placeholder="What for — e.g. AMIR SFX, NoTraffic sounds" maxLength={120} className={field} />
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={onEnter} placeholder="Amount" className={`${field} text-right`} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field} aria-label="Currency">
            <option value="EUR">€</option>
            <option value="USD">$</option>
            <option value="ILS">₪</option>
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onEnter} placeholder="Note (optional)" maxLength={200} className={field} />
          <AddButton saving={saving} label={editing ? "Save" : "Add"} onClick={() => void submit()} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs text-faint">
        {kind === "hours"
          ? "Type a task in your own words, or pick one Studio&more already filed you on."
          : "Money you're charging on top of your hours — another freelancer you brought in, a purchase."}
      </p>
    </div>
  );
}

function AddButton({ saving, label, onClick }: { saving: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
    >
      {label === "Add" && <Plus size={15} />} {saving ? "Saving…" : label}
    </button>
  );
}

/** Every month he has, newest first: hours, that month's rate, the bill —
 * click one to open it. */
function Months({ data, onPick }: { data: Data; onPick: (p: string) => void }) {
  const cur = data.summary.currency;
  const short = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1].slice(0, 3)} ${p.slice(2, 4)}`;
  return (
    <aside className="rounded-2xl border border-border bg-surface p-3 text-sm shadow-card">
      <h2 className="mb-1 px-1 text-base font-medium">Months</h2>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full tabular-nums">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-[11px] uppercase tracking-wide text-faint">
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
                className={`cursor-pointer ${m.period === data.period ? "bg-brand-soft font-medium text-brand-dark" : "hover:bg-background"}`}
                title={m.extras > 0 ? `Includes ${money(m.extras, cur)} extras` : undefined}
              >
                <td className="whitespace-nowrap rounded-l-md px-1 py-1">{short(m.period)}</td>
                <td className="px-1 py-1 text-right">{hrs(m.hours)}</td>
                <td className="px-1 py-1 text-right text-muted">{money(m.rate, cur)}</td>
                <td className="whitespace-nowrap rounded-r-md px-1 py-1 text-right">
                  {money(m.total, cur)}
                  {m.otherExtras.map((o) => ` + ${money(o.amount, o.currency)}`).join("")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

/** Links he leaves for Studio&more — a delivery, a shared folder. */
function Deliverables({ data, api, onChanged }: { data: Data; api: string; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    setError(null);
    setSaving(true);
    const r = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "link", title, url }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(j.error ?? "Couldn't save — try again.");
    setTitle("");
    setUrl("");
    onChanged();
  }

  return (
    <aside className="h-fit rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <FolderOpen size={17} className="text-brand" /> Deliverables &amp; folders
      </h2>
      <p className="mt-0.5 text-xs text-muted">Links to what you delivered, or a shared folder.</p>
      <ul className="mt-3 space-y-1.5">
        {data.deliverables.length === 0 && <li className="text-sm text-faint">No links yet.</li>}
        {data.deliverables.map((d) => (
          <li key={d.id} className="group flex items-start gap-2 text-sm">
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-start gap-1.5 text-brand hover:underline">
              <ExternalLink size={13} className="mt-0.5 shrink-0" />
              <span className="bidi-auto break-words">{d.title}</span>
            </a>
            <span className="shrink-0 text-xs text-faint">{dayLabel(d.date)}</span>
            <button
              onClick={async () => {
                if (!confirm("Remove this link?")) return;
                await fetch(`${api}?link=${encodeURIComponent(d.id)}`, { method: "DELETE" });
                onChanged();
              }}
              className="shrink-0 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              aria-label="Remove link"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Sensor 3 — final renders" maxLength={120} className={field} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" className={field} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          onClick={() => void add()}
          disabled={saving || !title.trim() || !url.trim()}
          className="flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          <Plus size={14} /> Add link
        </button>
      </div>
    </aside>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1300px] px-4 py-6">{children}</div>
    </div>
  );
}
