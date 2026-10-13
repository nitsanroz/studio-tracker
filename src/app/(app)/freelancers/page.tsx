"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { useIsAdmin } from "@/lib/store";

// Freelancers' logs waiting for review, and each freelancer's private link,
// clients and month (0054). Admin-only; everything goes through
// /api/admin/freelancers. Approving a log files it on a task as real hours.

interface Terms {
  currency: string;
  rateHigh: number;
  rateLow: number;
  hoursLow: number;
  hoursHigh: number;
}
interface Freelancer {
  profileId: string;
  name: string;
  token: string;
  active: boolean;
  terms: Terms;
  clientIds: string[];
  deliverables: { title: string; url: string; date: string }[];
  month: { hours: number; rate: number; bill: number };
}
interface Pending {
  id: string;
  profileId: string;
  date: string;
  hours: number;
  clientId: string | null;
  taskId: string | null;
  taskHint: string | null;
  description: string;
}
interface Data {
  clients: { id: string; name: string }[];
  freelancers: Freelancer[];
  pending: Pending[];
  tasks: { id: string; title: string; clientId: string; done: boolean }[];
}

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", ILS: "₪" };
const money = (n: number, c: string) =>
  `${SYMBOL[c] ?? `${c} `}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => `${Number(n.toFixed(2)).toLocaleString("en-US")}h`;
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

async function act(body: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/admin/freelancers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.error ?? "Something went wrong";
}

export default function FreelancersPage() {
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetch("/api/admin/freelancers", { cache: "no-store" })
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as Data)
          : Promise.reject(new Error((await r.json()).error)),
      )
      .then((d) => alive && setData(d))
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      alive = false;
    };
  }, [isAdmin, version]);

  if (!isAdmin)
    return <p className="py-20 text-center text-sm text-muted">Admins only.</p>;
  if (error)
    return <p className="py-20 text-center text-sm text-danger">{error}</p>;
  if (!data)
    return <p className="py-20 text-center text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-[1100px] space-y-8">
      <div>
        <h1 className="font-serif-accent text-[28px] leading-9">Freelancers</h1>
        <p className="text-sm text-muted">
          They log hours through a private link — no login, so they see only
          their own logs. Every log waits here until you file it on a task.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">
          Waiting for review{" "}
          {data.pending.length > 0 && (
            <span className="text-foreground">({data.pending.length})</span>
          )}
        </h2>
        {data.pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            Nothing waiting.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {data.pending.map((l) => (
              <PendingRow
                key={l.id}
                log={l}
                who={
                  data.freelancers
                    .find((f) => f.profileId === l.profileId)
                    ?.name.split(" ")[0] ?? ""
                }
                clients={data.clients}
                tasks={data.tasks.filter((t) => t.clientId === l.clientId)}
                onDone={reload}
              />
            ))}
          </ul>
        )}
      </section>

      {data.freelancers.map((f) => (
        <FreelancerCard
          key={f.profileId}
          f={f}
          clients={data.clients}
          onDone={reload}
        />
      ))}

      <AddFreelancer onDone={reload} />
    </div>
  );
}

function PendingRow({
  log,
  who,
  clients,
  tasks: initialTasks,
  onDone,
}: {
  log: Pending;
  who: string;
  clients: Data["clients"];
  tasks: Data["tasks"];
  onDone: () => void;
}) {
  // He may have named the work but not the client — the admin files both.
  const [clientId, setClientId] = useState(log.clientId ?? "");
  const [tasks, setTasks] = useState(initialTasks);
  const [taskId, setTaskId] = useState(log.taskId ?? "");
  useEffect(() => {
    if (!clientId || clientId === log.clientId) return;
    let alive = true;
    fetch(`/api/admin/freelancers?tasks=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j: { tasks?: Data["tasks"] }) => alive && setTasks(j.tasks ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [clientId, log.clientId]);
  const shown =
    clientId === log.clientId ? initialTasks : clientId ? tasks : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = shown.filter((t) => !t.done);
  const done = shown.filter((t) => t.done);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(await act(body));
    setBusy(false);
    onDone();
  }

  return (
    <li className="grid grid-cols-[140px_minmax(0,1fr)_320px] items-start gap-4 px-4 py-3">
      <div className="text-sm">
        <p className="font-medium">{dayLabel(log.date)}</p>
        <p className="text-muted">
          {who} · <span className="tabular-nums">{hrs(log.hours)}</span>
        </p>
      </div>
      <div className="min-w-0 text-sm">
        {log.taskHint && (
          <p className="bidi-auto font-medium">
            &ldquo;{log.taskHint}&rdquo;{" "}
            <span className="font-normal text-faint">— his name for it</span>
          </p>
        )}
        <p className="bidi-auto whitespace-pre-wrap text-muted">
          {log.description}
        </p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setTaskId("");
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={taskId}
          disabled={!clientId}
          onChange={(e) => setTaskId(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">File on a task…</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
          {done.length > 0 && (
            <optgroup label="Done">
              {done.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <div className="flex gap-2">
          <button
            disabled={busy || !taskId}
            onClick={() => run({ action: "approve", id: log.id, taskId })}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            <Check size={14} /> Approve
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const note = prompt(
                "Turn this log down? Add a note for him (optional):",
              );
              if (note !== null)
                void run({ action: "reject", id: log.id, note });
            }}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-danger"
          >
            <X size={14} /> Reject
          </button>
        </div>
      </div>
    </li>
  );
}

function FreelancerCard({
  f,
  clients,
  onDone,
}: {
  f: Freelancer;
  clients: Data["clients"];
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(f.clientIds));
  const [copied, setCopied] = useState(false);
  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/log/${f.token}`;
  const enabled = useMemo(
    () => clients.filter((c) => f.clientIds.includes(c.id)),
    [clients, f.clientIds],
  );
  const c = f.terms.currency;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      {/* Hero: who, and where their month stands. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 bg-brand px-5 py-5 text-white">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-white/70">
            Freelancer
          </p>
          <h2 className="font-serif-accent text-[32px] leading-10">{f.name}</h2>
          <p className="mt-1 text-xs text-white/75">
            {termsLine(f.terms)}
            {!f.active && (
              <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 font-medium text-white">
                Link switched off
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/70">This month</p>
          <p className="text-3xl font-semibold tabular-nums">
            {money(f.month.bill, c)}
          </p>
          <p className="text-sm tabular-nums text-white/80">
            {hrs(f.month.hours)} × {money(f.month.rate, c)}/h
          </p>
        </div>
      </div>

      <div className="p-5 pt-4">
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
                onDone();
              }
              return err;
            }}
          />
        ) : (
          <p className="text-xs text-muted">
            The bill counts every hour not turned down ·{" "}
            <button
              onClick={() => setEditingTerms(true)}
              className="text-brand hover:underline"
            >
              Edit terms
            </button>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Private link:</span>
          <code className="max-w-[360px] truncate rounded bg-background px-2 py-1 text-xs">
            {link}
          </code>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
          >
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
          >
            <ExternalLink size={12} /> Open his page
          </a>
          <button
            onClick={async () => {
              if (!confirm("Make a new link? The current one stops working."))
                return;
              await act({ action: "regenerate", profileId: f.profileId });
              onDone();
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
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
              onDone();
            }}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
          >
            {f.active ? "Switch link off" : "Switch link on"}
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Clients he can log against:</span>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-brand hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {!editing ? (
            <p className="mt-1 text-sm">
              {enabled.length ? (
                enabled.map((x) => x.name).join(" · ")
              ) : (
                <span className="text-muted">None yet</span>
              )}
            </p>
          ) : (
            <div className="mt-2">
              <div className="grid max-h-64 grid-cols-3 gap-x-4 gap-y-1 overflow-auto rounded-lg border border-border p-3">
                {clients.map((cl) => (
                  <label
                    key={cl.id}
                    className="flex items-center gap-2 text-sm"
                  >
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
                    setEditing(false);
                    onDone();
                  }}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setPicked(new Set(f.clientIds));
                    setEditing(false);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm text-muted">His deliverables &amp; folders:</p>
          {f.deliverables.length === 0 ? (
            <p className="mt-1 text-sm text-faint">None yet</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {f.deliverables.map((d) => (
                <li key={d.url + d.date} className="flex items-center gap-2 text-sm">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-brand hover:underline">
                    <ExternalLink size={12} /> <span className="bidi-auto">{d.title}</span>
                  </a>
                  <span className="text-xs text-faint">{d.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** "€55.00/h up to 50h a month, sliding to €45.00/h from 150h" — or a flat rate. */
function termsLine(t: Terms): string {
  if (t.rateHigh === t.rateLow)
    return `${money(t.rateHigh, t.currency)}/h, flat`;
  return `${money(t.rateHigh, t.currency)}/h up to ${t.hoursLow}h a month, sliding to ${money(t.rateLow, t.currency)}/h from ${t.hoursHigh}h`;
}

const numCls =
  "w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums";

/** A freelancer's rate terms, as the sentence they read as. Equal rates make a flat rate. */
function TermsForm({
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
      onChange={(e) =>
        setT({ ...t, [k]: Number(e.target.value.replace(",", ".")) || 0 })
      }
      className={numCls}
    />
  );
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
      {children}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <select
          value={t.currency}
          onChange={(e) => setT({ ...t, currency: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
        >
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
      <p className="text-xs text-muted">
        Same rate in both boxes = a flat hourly rate.
      </p>
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
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddFreelancer({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted hover:border-brand hover:text-brand"
      >
        + Add a freelancer
      </button>
    );
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-base font-medium">Add a freelancer</h2>
      <p className="text-xs text-muted">
        They get a private link to log hours — no login, and they never appear
        among the studio&apos;s members.
      </p>
      <TermsForm
        initial={{
          currency: "EUR",
          rateHigh: 50,
          rateLow: 50,
          hoursLow: 50,
          hoursHigh: 150,
        }}
        submitLabel="Add freelancer"
        onCancel={() => setOpen(false)}
        onSubmit={async (t) => {
          if (!name.trim()) return "Give the freelancer a name.";
          const err = await act({ action: "create", name, ...t });
          if (!err) {
            setOpen(false);
            setName("");
            onDone();
          }
          return err;
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </TermsForm>
    </section>
  );
}
