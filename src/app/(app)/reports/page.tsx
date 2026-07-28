"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, X } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/db";
import {
  formatFeedDate,
  formatHours,
  formatHoursShort,
  parseDuration,
  toISODate,
  MONTH_NAMES_SHORT,
} from "@/lib/format";
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/date-ranges";
import { Avatar, ClientChip } from "@/components/ui";
import { HBar, MiniColumns, SplitBar } from "@/components/charts";

interface ReportEntry {
  id: string; // "" for rows added locally this session (not editable until reload)
  task_id: string;
  /** null on recovered pre-Everhour rows whose author has no profile (migration 0017) */
  user_id: string | null;
  legacy?: boolean;
  /** raw Asana author for those rows — they are people who left years ago */
  legacy_author_name?: string | null;
  date: string;
  minutes: number;
  description: string;
}

/** minutes → "H:MM", the one duration format parseDuration round-trips exactly */
function minutesToInput(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function EditableMinutes({
  entry,
  onSaved,
}: {
  entry: ReportEntry;
  onSaved: (id: string, minutes: number) => void;
}) {
  const { updateTimeEntry } = useData();
  const [value, setValue] = useState(() => minutesToInput(entry.minutes));
  const parsed = parseDuration(value);

  function commit() {
    if (parsed == null || parsed <= 0 || parsed === entry.minutes) {
      setValue(minutesToInput(entry.minutes));
      return;
    }
    updateTimeEntry(entry.id, { minutes: parsed });
    onSaved(entry.id, parsed);
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`w-14 shrink-0 rounded-md border bg-transparent px-1 py-0.5 text-sm font-semibold tabular-nums outline-none focus:border-brand ${
        parsed == null || parsed <= 0 ? "border-danger" : "border-transparent hover:border-border"
      }`}
      title="Edit hours (e.g. 1:30, 1.5h, 90m)"
    />
  );
}

// ── task drill-in: period entries + add time ───────────────────────────────

function TaskHoursModal({
  taskId,
  entries,
  onAdd,
  onUpdate,
  onClose,
}: {
  taskId: string;
  entries: ReportEntry[];
  onAdd: (entry: ReportEntry) => void;
  onUpdate: (id: string, minutes: number) => void;
  onClose: () => void;
}) {
  const { tasks, sections, clients, profiles, addTimeEntry, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => toISODate(new Date()));

  const task = tasks.find((t) => t.id === taskId);
  const section = sections.find((s) => s.id === task?.sectionId);
  const client = clients.find((c) => c.id === task?.clientId);

  const rows = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    [entries],
  );
  const total = rows.reduce((s, e) => s + e.minutes, 0);
  const minutes = parseDuration(duration);
  const canAdd = minutes != null && minutes > 0 && description.trim();

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="bidi-auto truncate font-heading text-sm">{task?.title ?? "Task"}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              {client && <ClientChip client={client} size="sm" link={false} />}
              <span className="truncate">{section?.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{formatHours(total)} in period</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((e, i) => {
            const user = profiles.find((p) => p.id === e.user_id) ?? null;
            const authorLabel = user?.name ?? e.legacy_author_name ?? "";
            const editable = !!e.id && (isAdmin || e.user_id === currentUserId);
            return (
              <div
                key={e.id || `${e.date}-${i}`}
                className="flex items-center gap-2.5 border-b border-border py-2 text-sm last:border-b-0"
              >
                {/* A recovered pre-Everhour row has no profile, so the avatar is
                    blank — the tooltip is the only place its author appears. */}
                <span className="shrink-0" title={authorLabel || undefined}>
                  <Avatar profile={user} size={24} />
                </span>
                <span className="w-20 shrink-0 text-xs text-muted">{formatFeedDate(e.date)}</span>
                {editable ? (
                  <EditableMinutes entry={e} onSaved={onUpdate} />
                ) : (
                  <span className="w-14 shrink-0 font-semibold tabular-nums">
                    {formatHours(e.minutes)}
                  </span>
                )}
                <span className="bidi-auto min-w-0 flex-1 truncate text-muted">
                  {e.description || <span className="italic text-faint">no description</span>}
                </span>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="py-4 text-center text-sm text-faint">No hours in this period.</p>
          )}
        </div>

        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="1.5h"
            className={`w-16 rounded-md border bg-surface px-1.5 py-1.5 text-sm outline-none focus:border-brand ${
              duration && minutes == null ? "border-danger" : "border-border"
            }`}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (required)"
            className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            disabled={!canAdd}
            onClick={() => {
              if (!canAdd || minutes == null) return;
              addTimeEntry(taskId, minutes, description.trim(), date);
              onAdd({
                id: "",
                task_id: taskId,
                user_id: currentUserId,
                date,
                minutes,
                description: description.trim(),
              });
              setDuration("");
              setDescription("");
            }}
            className="flex shrink-0 items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </>
  );
}

// ── range stats: top of page, driven by the period preset + filters ─────────

function RangeStats({
  enriched,
  profiles,
}: {
  enriched: (ReportEntry & { task?: { billable: boolean } })[];
  profiles: ReturnType<typeof useData>["profiles"];
}) {
  const total = enriched.reduce((s, e) => s + e.minutes, 0);
  const billable = enriched.reduce((s, e) => s + (e.task?.billable ? e.minutes : 0), 0);
  const productivity = total > 0 ? Math.round((billable / total) * 100) : null;

  const byUser = useMemo(() => {
    // Recovered pre-Everhour rows may name an author who has no profile (they left
    // long before the current roster). Dropping them — as a `.filter(r => r.profile)`
    // used to — left their hours in the period total but missing from these bars, so
    // the breakdown silently failed to add up. They are grouped by their raw name.
    const map = new Map<string, number>();
    for (const e of enriched) {
      const key = e.user_id ?? `name:${e.legacy_author_name || "Unknown"}`;
      map.set(key, (map.get(key) ?? 0) + e.minutes);
    }
    return [...map.entries()]
      .map(([id, minutes]) => ({
        profile: id.startsWith("name:") ? undefined : profiles.find((p) => p.id === id),
        formerName: id.startsWith("name:") ? id.slice(5) : null,
        minutes,
      }))
      .filter((r) => r.profile || r.formerName)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6);
  }, [enriched, profiles]);
  const maxUser = byUser[0]?.minutes ?? 0;

  // per-day within short ranges, per-month otherwise
  const buckets = useMemo(() => {
    const days = new Set(enriched.map((e) => e.date));
    const byDay = days.size <= 31;
    const map = new Map<string, number>();
    for (const e of enriched) {
      const key = byDay ? e.date : e.date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + e.minutes);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, minutes]) => ({
        label: byDay
          ? key.slice(8).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "")
          : MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1],
        minutes,
      }));
  }, [enriched]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-4 text-center">
        <div className="text-4xl font-bold tabular-nums text-brand">
          {productivity == null ? "–" : `${productivity}%`}
        </div>
        <div className="mt-1 text-xs text-muted" title="Billable hours ÷ all hours in the selected range">
          billable share in this period
        </div>
        <div className="mt-2">
          <SplitBar billable={billable} nonBillable={total - billable} maxMinutes={total} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-faint">
          <span>{formatHoursShort(billable)} billable</span>
          <span>{formatHoursShort(total - billable)} non-bill.</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h3
          className="mb-2 text-xs font-medium uppercase tracking-wide text-faint"
          title="Hours per day (short ranges) or per month, within the selected range and filters"
        >
          Hours in period
        </h3>
        <MiniColumns points={buckets} />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
        <h3
          className="text-xs font-medium uppercase tracking-wide text-faint"
          title="Who logged the hours in the selected range (top 6)"
        >
          Hours by user
        </h3>
        {byUser.map(({ profile, formerName, minutes }) => (
          <HBar
            key={profile?.id ?? `former:${formerName}`}
            label={
              profile ? (
                <span className="flex items-center gap-1.5">
                  <Avatar profile={profile} size={16} />
                  {profile.name}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted" title="Recovered from the pre-Everhour Asana history; this person has no account here">
                  <span className="size-4 shrink-0 rounded-full border border-dashed border-border-strong" />
                  {formerName}
                </span>
              )
            }
            right={formatHoursShort(minutes)}
            minutes={minutes}
            maxMinutes={maxUser}
          />
        ))}
        {byUser.length === 0 && <p className="text-sm text-faint">No hours in this period.</p>}
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { tasks, sections, clients, profiles, currentUserId } = useData();
  const supabase = useMemo(() => createClient(), []);
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const [preset, setPreset] = useState<RangePreset>("This week");
  const [range, setRange] = useState(() => presetRange("This week"));
  const [clientFilter, setClientFilter] = useState("");
  const [designerFilter, setDesignerFilter] = useState("");
  const [billableFilter, setBillableFilter] = useState<"" | "billable" | "non_billable">("");
  const [entries, setEntries] = useState<ReportEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [foldedSections, setFoldedSections] = useState<Set<string>>(new Set());
  const [taskModal, setTaskModal] = useState<string | null>(null);

  function pickPreset(p: RangePreset) {
    setPreset(p);
    if (p !== "Custom") setRange(presetRange(p));
  }

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetchAll<ReportEntry>(
      supabase,
      "time_entries",
      "id, task_id, user_id, date, minutes, description, legacy, legacy_author_name",
      (q) => q.gte("date", range.from).lte("date", range.to).not("minutes", "is", null),
    )
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e) => console.error("report query failed", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [supabase, range.from, range.to, isAdmin]);

  const enriched = useMemo(() => {
    if (!entries) return [];
    return entries
      .map((e) => {
        const task = taskById.get(e.task_id);
        const client = task ? clientById.get(task.clientId) : undefined;
        return { ...e, task, client };
      })
      .filter((e) => {
        if (!e.client) return false;
        if (clientFilter && e.client.id !== clientFilter) return false;
        if (designerFilter && e.user_id !== designerFilter) return false;
        if (billableFilter === "billable" && !e.task?.billable) return false;
        if (billableFilter === "non_billable" && e.task?.billable) return false;
        return true;
      });
  }, [entries, taskById, clientById, clientFilter, designerFilter, billableFilter]);

  const byClient = useMemo(() => {
    const map = new Map<string, { billable: number; total: number }>();
    for (const e of enriched) {
      const row = map.get(e.client!.id) ?? { billable: 0, total: 0 };
      row.total += e.minutes;
      if (e.task?.billable) row.billable += e.minutes;
      map.set(e.client!.id, row);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ client: clientById.get(id)!, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [enriched, clientById]);

  /** client → sections → tasks with minutes (for expanded rows). */
  const clientBreakdown = useMemo(() => {
    const out = new Map<
      string,
      Map<string, { sectionName: string; tasks: Map<string, number>; total: number }>
    >();
    for (const e of enriched) {
      if (!e.task) continue;
      const clientId = e.client!.id;
      const sectionKey = e.task.sectionId ?? "none";
      const sectionName = e.task.sectionId
        ? (sectionById.get(e.task.sectionId)?.name ?? "Section")
        : "No section";
      let secMap = out.get(clientId);
      if (!secMap) out.set(clientId, (secMap = new Map()));
      let sec = secMap.get(sectionKey);
      if (!sec) secMap.set(sectionKey, (sec = { sectionName, tasks: new Map(), total: 0 }));
      sec.tasks.set(e.task_id, (sec.tasks.get(e.task_id) ?? 0) + e.minutes);
      sec.total += e.minutes;
    }
    return out;
  }, [enriched, sectionById]);

  const totalMinutes = enriched.reduce((s, e) => s + e.minutes, 0);
  const billableMinutes = enriched.reduce((s, e) => s + (e.task?.billable ? e.minutes : 0), 0);
  const maxClientTotal = byClient[0]?.total ?? 0;

  const exportCSV = useCallback(() => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Date", "User", "Client", "Section", "Task", "Hours", "Billable", "Description"].join(","),
      ...enriched
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) =>
          [
            e.date,
            esc(profileById.get(e.user_id ?? "")?.name ?? e.legacy_author_name ?? ""),
            esc(e.client?.name ?? ""),
            esc(e.task?.sectionId ? (sectionById.get(e.task.sectionId)?.name ?? "") : ""),
            esc(e.task?.title ?? ""),
            (e.minutes / 60).toFixed(2),
            e.task?.billable ? "yes" : "no",
            esc(e.description),
          ].join(","),
        ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `studio-report-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [enriched, profileById, sectionById, range]);

  const activeProfiles = profiles.filter((p) => p.active);

  if (!isAdmin) {
    return <p className="text-sm text-muted">Reports are for admins only.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Reports</h1>
          <p className="text-sm text-muted">
            {range.from} → {range.to} ·{" "}
            {loading
              ? "loading…"
              : `${formatHoursShort(totalMinutes)} total, ${formatHoursShort(billableMinutes)} billable`}
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={enriched.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => pickPreset(p)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              preset === p
                ? "border-brand bg-brand-soft text-brand-dark"
                : "border-border bg-surface text-muted hover:border-border-strong"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {preset === "Custom" && (
          <>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </>
        )}
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">All clients</option>
          {clients
            .filter((c) => !c.archived)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <select
          value={designerFilter}
          onChange={(e) => setDesignerFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">All users</option>
          {activeProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={billableFilter}
          onChange={(e) => setBillableFilter(e.target.value as typeof billableFilter)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Billable + non-billable</option>
          <option value="billable">Billable only</option>
          <option value="non_billable">Non-billable only</option>
        </select>
      </div>

      {/* ── two columns: client table left, stat panes stacked right ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* ── per-client expandable table with billable split graph ── */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="flex-1" title="Clients with hours in the selected range — click a row for its tasks">
            Client
          </span>
          <span className="w-40" title="Billable (blue) vs non-billable (grey) hours">
            Billable split
          </span>
          <span className="w-20 text-right" title="Hours on billable tasks in the range">
            Billable
          </span>
          <span className="w-20 text-right" title="Hours on non-billable tasks in the range">
            Non-bill.
          </span>
          <span className="w-20 text-right" title="All hours in the range">
            Total
          </span>
        </div>
        {byClient.map(({ client, billable, total }) => {
          const isOpen = expanded.has(client.id);
          const breakdown = clientBreakdown.get(client.id);
          return (
            <div key={client.id} className="border-b border-border last:border-b-0">
              <div
                className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-background"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(client.id)) next.delete(client.id);
                    else next.add(client.id);
                    return next;
                  })
                }
              >
                <span className="flex flex-1 items-center gap-1.5">
                  <ClientChip client={client} link={false} />
                </span>
                <span className="w-40">
                  <SplitBar
                    billable={billable}
                    nonBillable={total - billable}
                    maxMinutes={maxClientTotal}
                  />
                </span>
                <span className="w-20 text-right font-medium tabular-nums">
                  {formatHoursShort(billable)}
                </span>
                <span className="w-20 text-right tabular-nums text-muted">
                  {formatHoursShort(total - billable)}
                </span>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {formatHoursShort(total)}
                </span>
              </div>
              {isOpen && breakdown && (
                <div className="bg-background/50 px-4 pb-3 pt-1.5">
                  {[...breakdown.entries()].map(([sectionKey, sec]) => {
                    const foldKey = `${client.id}:${sectionKey}`;
                    const folded = foldedSections.has(foldKey);
                    return (
                      <div key={sectionKey} className="mb-1.5 last:mb-0">
                        <button
                          onClick={() =>
                            setFoldedSections((prev) => {
                              const next = new Set(prev);
                              if (next.has(foldKey)) next.delete(foldKey);
                              else next.add(foldKey);
                              return next;
                            })
                          }
                          className="flex w-full items-center gap-1 rounded-md bg-gray-200/80 px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-gray-200"
                        >
                          <span className="bidi-auto min-w-0 flex-1 truncate text-left">
                            {sec.sectionName}
                          </span>
                          <span className="tabular-nums">{formatHoursShort(sec.total)}</span>
                        </button>
                        {!folded &&
                          [...sec.tasks.entries()]
                            .sort((a, b) => b[1] - a[1])
                            .map(([taskId, minutes]) => (
                              <button
                                key={taskId}
                                onClick={() => setTaskModal(taskId)}
                                title={
                                  enriched
                                    .filter((e) => e.task_id === taskId && e.description.trim())
                                    .slice(0, 8)
                                    .map((e) => `${formatHoursShort(e.minutes)} — ${e.description}`)
                                    .join("\n") || undefined
                                }
                                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-brand-soft/50"
                              >
                                <span className="bidi-auto min-w-0 flex-1 truncate">
                                  {taskById.get(taskId)?.title ?? "(deleted task)"}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted">
                                  {formatHoursShort(minutes)}
                                </span>
                              </button>
                            ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {byClient.length === 0 && !loading && (
          <div className="px-4 py-6 text-center text-sm text-faint">No hours in this range.</div>
        )}
      </div>

      {/* ── stats for the selected period + filters ── */}
      <div className="w-full shrink-0 lg:w-[360px]">
        <RangeStats enriched={enriched} profiles={profiles} />
      </div>
      </div>

      {taskModal && (
        <TaskHoursModal
          taskId={taskModal}
          entries={enriched.filter((e) => e.task_id === taskModal)}
          onAdd={(entry) => setEntries((prev) => (prev ? [...prev, entry] : [entry]))}
          onUpdate={(id, minutes) =>
            setEntries((prev) =>
              prev ? prev.map((e) => (e.id === id ? { ...e, minutes } : e)) : prev,
            )
          }
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  );
}
