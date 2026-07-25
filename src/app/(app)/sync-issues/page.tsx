"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Link2, Plus, RefreshCw } from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate, formatHours } from "@/lib/format";
import { TaskAutocomplete } from "@/components/task-autocomplete";

/**
 * Everhour sync queue. The nightly sync can't import an entry whose Everhour
 * task or person isn't mapped here — those hours are real and usually
 * billable, so they land in this queue instead of a log line nobody reads.
 * Nothing leaves the queue until it's imported or explicitly ignored.
 */

interface SyncIssue {
  id: string;
  everhour_id: string;
  kind: "unmapped_task" | "unmapped_user" | "unmapped_both";
  entry_date: string;
  minutes: number;
  description: string;
  everhour_task_id: string | null;
  everhour_task_name: string;
  everhour_user_id: string;
  everhour_user_name: string;
  status: "open" | "imported" | "ignored";
  note: string;
}

type Status = "open" | "ignored" | "imported";

interface Group {
  key: string;
  by: "task" | "user";
  /** Everhour id of the thing that needs mapping */
  ref: string;
  label: string;
  issues: SyncIssue[];
  minutes: number;
  from: string;
  to: string;
}

function groupIssues(issues: SyncIssue[]): Group[] {
  const groups = new Map<string, Group>();
  for (const i of issues) {
    // an entry can fail on its task, its person, or both — the task is the
    // thing to fix first, so it wins when both are unmapped
    const by: "task" | "user" = i.kind === "unmapped_user" ? "user" : "task";
    const ref = by === "task" ? (i.everhour_task_id ?? "(no task)") : i.everhour_user_id;
    const key = `${by}:${ref}`;
    const label =
      by === "task"
        ? i.everhour_task_name || "(entry with no Everhour task)"
        : i.everhour_user_name || `Everhour person ${i.everhour_user_id}`;
    const g = groups.get(key) ?? {
      key,
      by,
      ref,
      label,
      issues: [],
      minutes: 0,
      from: i.entry_date,
      to: i.entry_date,
    };
    g.issues.push(i);
    g.minutes += i.minutes;
    if (i.entry_date < g.from) g.from = i.entry_date;
    if (i.entry_date > g.to) g.to = i.entry_date;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}

function GroupCard({ group, onDone }: { group: Group; onDone: () => void }) {
  const { clients, sections, profiles } = useData();
  const [mode, setMode] = useState<"none" | "link" | "create" | "user">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // create-task draft
  const [clientId, setClientId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [title, setTitle] = useState(group.label);
  const clientSections = useMemo(
    () => sections.filter((s) => s.clientId === clientId),
    [sections, clientId],
  );

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/sync-issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.error ?? "Something went wrong.");
          setBusy(false);
          return;
        }
        onDone();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    },
    [onDone],
  );

  const isOpen = group.issues[0]?.status === "open";

  return (
    <div className="card flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="bidi-auto flex items-center gap-2 text-[15px] font-medium">
            {group.by === "task" ? (
              <AlertTriangle size={16} strokeWidth={1.75} className="shrink-0 text-danger" />
            ) : (
              <AlertTriangle size={16} strokeWidth={1.75} className="shrink-0 text-amber-500" />
            )}
            <span className="truncate">{group.label}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {group.by === "task" ? "Everhour task" : "Everhour person"}{" "}
            <code className="rounded bg-background px-1 py-0.5">{group.ref}</code> isn&apos;t mapped
            to {group.by === "task" ? "a tracker task" : "a member"} · {group.issues.length}{" "}
            {group.issues.length === 1 ? "entry" : "entries"} ·{" "}
            <b className="text-foreground">{formatHours(group.minutes)}</b> ·{" "}
            {formatDate(group.from)}
            {group.from !== group.to && ` – ${formatDate(group.to)}`}
          </p>
        </div>
        {isOpen && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {group.by === "task" ? (
              <>
                <button
                  onClick={() => setMode(mode === "link" ? "none" : "link")}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
                >
                  <Link2 size={13} /> Link to a task
                </button>
                <button
                  onClick={() => setMode(mode === "create" ? "none" : "create")}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
                >
                  <Plus size={13} /> Create the task
                </button>
              </>
            ) : (
              <button
                onClick={() => setMode(mode === "user" ? "none" : "user")}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
              >
                <Link2 size={13} /> Link to a member
              </button>
            )}
            <button
              onClick={() => post({ action: "ignore", ids: group.issues.map((i) => i.id) })}
              disabled={busy}
              title="These hours are deliberately not coming into the tracker"
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Ignore
            </button>
          </div>
        )}
        {!isOpen && (
          <button
            onClick={() => post({ action: "reopen", ids: group.issues.map((i) => i.id) })}
            disabled={busy}
            className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50"
          >
            Reopen
          </button>
        )}
      </div>

      {mode === "link" && (
        <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
          <p className="mb-2 text-xs text-muted">
            Pick the tracker task these hours belong to. It gets this Everhour id, and the backlog
            imports straight away.
          </p>
          <TaskAutocomplete
            autoFocus
            placeholder="Find a task…"
            onPickTask={(m) =>
              post({ action: "link-task", everhourTaskId: group.ref, taskId: m.task.id })
            }
          />
        </div>
      )}

      {mode === "create" && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand-soft/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            post({ action: "create-task", everhourTaskId: group.ref, clientId, sectionId, title });
          }}
        >
          <p className="text-xs text-muted">
            This task only ever existed in Everhour. Create it here and the hours import straight
            away.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              required
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setSectionId("");
              }}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">Client…</option>
              {clients
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!clientId}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">No section</option>
              {clientSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task name"
              className="bidi-auto min-w-48 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <button
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Create &amp; import
            </button>
          </div>
        </form>
      )}

      {mode === "user" && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            post({
              action: "link-user",
              everhourUserId: group.ref,
              profileId: form.get("profileId"),
            });
          }}
        >
          <p className="w-full text-xs text-muted">
            Which member is this? Their profile gets this Everhour id.
          </p>
          <select
            name="profileId"
            required
            defaultValue=""
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">Member…</option>
            {profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Link &amp; import
          </button>
        </form>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="self-start text-xs text-muted hover:text-brand"
      >
        {expanded ? "Hide" : "Show"} the {group.issues.length}{" "}
        {group.issues.length === 1 ? "entry" : "entries"}
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-faint">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Hours</th>
                <th className="py-1.5 pr-3 font-medium">Who</th>
                <th className="py-1.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {[...group.issues]
                .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
                .map((i) => (
                  <tr key={i.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-muted">
                      {formatDate(i.entry_date)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                      {formatHours(i.minutes)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-muted">
                      {i.everhour_user_name || i.everhour_user_id}
                    </td>
                    <td className="bidi-auto py-1.5 text-muted">
                      {i.description || <span className="text-faint">—</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SyncIssuesPage() {
  const { profiles, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const [issues, setIssues] = useState<SyncIssue[] | null>(null);
  const [tab, setTab] = useState<Status>("open");
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-issues");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Couldn't load the queue.");
        setIssues([]);
        return;
      }
      setIssues(j.issues ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setIssues([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function syncNow() {
    setSyncing(true);
    await fetch("/api/everhour-sync?days=30", { method: "POST" }).catch(() => {});
    await load();
    setSyncing(false);
  }

  if (!isAdmin) return <p className="text-sm text-muted">Admins only.</p>;

  const shown = (issues ?? []).filter((i) => i.status === tab);
  const groups = groupIssues(shown);
  const openCount = (issues ?? []).filter((i) => i.status === "open").length;
  const openMinutes = (issues ?? [])
    .filter((i) => i.status === "open")
    .reduce((n, i) => n + i.minutes, 0);

  const TABS: { key: Status; label: string }[] = [
    { key: "open", label: `Needs a decision${openCount ? ` (${openCount})` : ""}` },
    { key: "ignored", label: "Ignored" },
    { key: "imported", label: "Resolved" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif-accent text-3xl">Sync issues</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Everhour entries the sync couldn&apos;t import because their task or person isn&apos;t
            mapped here. These hours are real — leaving one open means a client report can
            understate the work.
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync Everhour"}
        </button>
      </div>

      {openCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <AlertTriangle size={17} strokeWidth={1.75} className="shrink-0 text-danger" />
          <span>
            <b>{formatHours(openMinutes)}</b> across {openCount}{" "}
            {openCount === 1 ? "entry" : "entries"} hasn&apos;t made it into the tracker.
          </span>
        </div>
      )}

      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-brand text-white"
                : "border border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* An "all clear" we can't stand behind is worse than no answer, so a
          failed load never falls through to the reassuring empty state. */}
      {error && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <AlertTriangle size={17} strokeWidth={1.75} className="shrink-0 text-danger" />
          <span>{error} This is not an all-clear — the queue couldn&apos;t be read.</span>
          <button
            onClick={load}
            className="ml-auto shrink-0 rounded-md border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            Try again
          </button>
        </div>
      )}
      {issues === null && <p className="text-sm text-muted">Loading the queue…</p>}

      {issues !== null && !error && groups.length === 0 && (
        <div className="card flex items-center gap-2.5 rounded-2xl border border-border bg-surface px-4 py-8 text-sm text-muted">
          <Check size={18} strokeWidth={1.75} className="text-success" />
          {tab === "open"
            ? "Nothing outstanding — every Everhour entry has made it in."
            : tab === "ignored"
              ? "Nothing has been ignored."
              : "Nothing resolved yet."}
        </div>
      )}

      {groups.map((g) => (
        <GroupCard key={g.key} group={g} onDone={load} />
      ))}
    </div>
  );
}
