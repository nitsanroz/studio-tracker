"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, ExternalLink, FolderOpen, Plus, Trash2, X } from "lucide-react";

// A freelancer's page (0054–0056): his hours as a table, a month at a time,
// like the sheet he billed from — with a row at the bottom to add a log — and
// a pane of links to his deliverables.

// ⚠️ 16px text in every input on a phone: iOS Safari zooms the page when a
// focused input's text is smaller (same rule as the intake form).
const cellInput =
  "w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-base outline-none focus:border-brand bidi-auto md:text-sm";

interface Log {
  id: string;
  date: string;
  hours: number;
  client: string | null;
  task: string | null;
  taskHint: string | null;
  description: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  fromSheet: boolean;
}
interface Data {
  name: string;
  today: string;
  earliest: string;
  period: string;
  firstPeriod: string;
  clients: { id: string; name: string }[];
  tasks: { id: string; title: string; clientId: string }[];
  summary: { hours: number; rate: number; bill: number; currency: string };
  terms: { rateHigh: number; rateLow: number; hoursLow: number; hoursHigh: number };
  logs: Log[];
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

export function FreelancerLogView({ token }: { token: string }) {
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped after every change to read the month again.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const api = `/api/log/${encodeURIComponent(token)}`;

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
  // He can add logs to the months his backdating window reaches.
  const canLog = data.period >= data.earliest.slice(0, 7);

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
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-white">
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
        <p className="tabular-nums">
          <span className="text-2xl font-semibold">{hrs(data.summary.hours)}</span>
          <span className="text-white/80"> × {money(data.summary.rate, cur)}/h = </span>
          <span className="text-2xl font-semibold">{money(data.summary.bill, cur)}</span>
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <LogTable data={data} api={api} canLog={canLog} onChanged={reload} />
        <Deliverables data={data} api={api} onChanged={reload} />
      </div>
    </Shell>
  );
}

function LogTable({ data, api, canLog, onChanged }: { data: Data; api: string; canLog: boolean; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 font-medium">What I did</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.logs.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted">
                Nothing logged in {monthLabel(data.period)}.
              </td>
            </tr>
          )}
          {data.logs.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2">{dayLabel(l.date)}</td>
              <td className="px-3 py-2">{l.client ?? <span className="text-faint">—</span>}</td>
              <td className="bidi-auto px-3 py-2">
                {/* Filed: the task Studio&more put it on. Waiting: his own words. */}
                {l.task ??
                  (!l.taskHint ? (
                    <span className="text-faint">—</span>
                  ) : l.fromSheet ? (
                    l.taskHint
                  ) : (
                    <span className="text-muted">&ldquo;{l.taskHint}&rdquo;</span>
                  ))}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{hrs(l.hours)}</td>
              <td className="bidi-auto px-3 py-2 text-muted">
                {l.description !== l.taskHint && l.description !== l.task ? l.description : ""}
                {l.status === "rejected" && l.note && <span className="block text-xs text-danger">{l.note}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <Status log={l} />
              </td>
              <td className="px-2 py-2">{l.status === "pending" && !l.fromSheet && <RemoveLog api={api} id={l.id} onDone={onChanged} />}</td>
            </tr>
          ))}
          {canLog && <AddRow data={data} api={api} onSaved={onChanged} />}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/60 font-medium">
            <td colSpan={3} className="px-3 py-2 text-muted">
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{hrs(data.summary.hours)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The row at the bottom of the table that adds a log. The task cell is free
 * text that suggests the tasks he's been filed on — picking one of those files
 * the log on it; anything else is his own name for the work. */
function AddRow({ data, api, onSaved }: { data: Data; api: string; onSaved: () => void }) {
  const inMonth = data.today.startsWith(data.period);
  const lastOfMonth = `${data.period}-${String(new Date(Number(data.period.slice(0, 4)), Number(data.period.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const [date, setDate] = useState(inMonth ? data.today : lastOfMonth);
  const [clientId, setClientId] = useState(data.clients.length === 1 ? data.clients[0].id : "");
  const [task, setTask] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMemo(() => (clientId ? data.tasks.filter((t) => t.clientId === clientId) : data.tasks), [data.tasks, clientId]);
  const listId = `tasks-${data.period}`;

  async function submit() {
    setError(null);
    const h = Number(hours.replace(",", "."));
    if (!(h > 0 && h <= 24)) return setError("Enter the hours, e.g. 3.5");
    if (!description.trim() && !task.trim()) return setError("Say what you worked on.");
    const known = tasks.find((t) => t.title.toLowerCase() === task.trim().toLowerCase());
    setSaving(true);
    const r = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        minutes: Math.round(h * 60),
        clientId: clientId || known?.clientId || null,
        taskId: known?.id ?? null,
        taskHint: known ? null : task,
        description: description.trim() || task.trim(),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(j.error ?? "Couldn't save — try again.");
    setTask("");
    setHours("");
    setDescription("");
    onSaved();
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <>
      <tr className="bg-brand-soft/30 align-top">
        <td className="px-2 py-2">
          <input type="date" value={date} min={data.earliest} max={data.today} onChange={(e) => setDate(e.target.value)} className={cellInput} />
        </td>
        <td className="px-2 py-2">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={cellInput}>
            <option value="">Not sure</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2">
          <input list={listId} value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onEnter} placeholder="Task" maxLength={120} className={cellInput} />
          <datalist id={listId}>
            {tasks.map((t) => (
              <option key={t.id} value={t.title} />
            ))}
          </datalist>
        </td>
        <td className="px-2 py-2">
          <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} onKeyDown={onEnter} placeholder="3.5" className={`${cellInput} w-16 text-right`} />
        </td>
        <td className="px-2 py-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={onEnter} placeholder="What you did" maxLength={600} className={cellInput} />
        </td>
        <td className="px-2 py-2" colSpan={2}>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            <Plus size={14} /> {saving ? "Adding…" : "Add"}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-2 text-sm text-danger">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function Status({ log }: { log: Log }) {
  if (log.fromSheet) return <span className="text-xs text-faint">From your sheet</span>;
  const s = {
    pending: { label: "Waiting for review", cls: "bg-warning/15 text-warning", Icon: Clock },
    approved: { label: "Approved", cls: "bg-success/15 text-success", Icon: Check },
    rejected: { label: "Not approved", cls: "bg-danger/10 text-danger", Icon: X },
  }[log.status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <s.Icon size={12} strokeWidth={2.2} /> {s.label}
    </span>
  );
}

function RemoveLog({ api, id, onDone }: { api: string; id: string; onDone: () => void }) {
  return (
    <button
      onClick={async () => {
        if (!confirm("Remove this log?")) return;
        await fetch(`${api}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        onDone();
      }}
      className="text-muted hover:text-danger"
      aria-label="Remove log"
    >
      <Trash2 size={14} />
    </button>
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
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Sensor 3 — final renders" maxLength={120} className={cellInput} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" className={cellInput} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          onClick={() => void add()}
          disabled={saving || !title.trim() || !url.trim()}
          className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
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
      <div className="mx-auto max-w-[1200px] px-4 py-6">{children}</div>
    </div>
  );
}
