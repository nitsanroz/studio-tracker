"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/db";
import { formatHoursShort } from "@/lib/format";
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/date-ranges";
import { Avatar, ClientChip } from "@/components/ui";

interface ReportEntry {
  task_id: string;
  user_id: string;
  date: string;
  minutes: number;
  description: string;
}

export default function ReportsPage() {
  const { tasks, projects, clients, profiles } = useData();
  const supabase = useMemo(() => createClient(), []);

  const [preset, setPreset] = useState<RangePreset>("This week");
  const [range, setRange] = useState(() => presetRange("This week"));
  const [clientFilter, setClientFilter] = useState("");
  const [designerFilter, setDesignerFilter] = useState("");
  const [billableFilter, setBillableFilter] = useState<"" | "billable" | "non_billable">("");
  const [entries, setEntries] = useState<ReportEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  function pickPreset(p: RangePreset) {
    setPreset(p);
    if (p !== "Custom") setRange(presetRange(p));
  }

  // Lookup maps
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAll<ReportEntry>(
      supabase,
      "time_entries",
      "task_id, user_id, date, minutes, description",
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
  }, [supabase, range.from, range.to]);

  const enriched = useMemo(() => {
    if (!entries) return [];
    return entries
      .map((e) => {
        const task = taskById.get(e.task_id);
        const project = task ? projectById.get(task.projectId) : undefined;
        const client = project ? clientById.get(project.clientId) : undefined;
        return { ...e, task, project, client };
      })
      .filter((e) => {
        if (!e.client) return false;
        if (clientFilter && e.client.id !== clientFilter) return false;
        if (designerFilter && e.user_id !== designerFilter) return false;
        if (billableFilter === "billable" && !e.task?.billable) return false;
        if (billableFilter === "non_billable" && e.task?.billable) return false;
        return true;
      });
  }, [entries, taskById, projectById, clientById, clientFilter, designerFilter, billableFilter]);

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

  const byDesigner = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of enriched) map.set(e.user_id, (map.get(e.user_id) ?? 0) + e.minutes);
    return [...map.entries()]
      .map(([id, minutes]) => ({ profile: profileById.get(id), minutes }))
      .filter((r) => r.profile)
      .sort((a, b) => b.minutes - a.minutes);
  }, [enriched, profileById]);

  const totalMinutes = enriched.reduce((s, e) => s + e.minutes, 0);
  const billableMinutes = enriched.reduce((s, e) => s + (e.task?.billable ? e.minutes : 0), 0);

  const exportCSV = useCallback(() => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Date", "Member", "Client", "Project", "Task", "Hours", "Billable", "Description"].join(","),
      ...enriched
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) =>
          [
            e.date,
            esc(profileById.get(e.user_id)?.name ?? ""),
            esc(e.client?.name ?? ""),
            esc(e.project?.name ?? ""),
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
  }, [enriched, profileById, range]);

  const activeProfiles = profiles.filter((p) => p.active);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Reports</h1>
          <p className="text-sm text-muted">
            {range.from} → {range.to} ·{" "}
            {loading ? "loading…" : `${formatHoursShort(totalMinutes)} total, ${formatHoursShort(billableMinutes)} billable`}
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
          <option value="">All members</option>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
            <span className="flex-1">Client</span>
            <span className="w-20 text-right">Billable</span>
            <span className="w-20 text-right">Non-bill.</span>
            <span className="w-20 text-right">Total</span>
          </div>
          {byClient.map(({ client, billable, total }) => (
            <div
              key={client.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0"
            >
              <span className="flex-1">
                <ClientChip client={client} />
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
          ))}
          {byClient.length === 0 && !loading && (
            <div className="px-4 py-6 text-center text-sm text-faint">
              No hours in this range.
            </div>
          )}
        </div>

        <div className="self-start overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
            <span className="flex-1">Member</span>
            <span className="w-20 text-right">Hours</span>
          </div>
          {byDesigner.map(({ profile, minutes }) => (
            <div
              key={profile!.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0"
            >
              <Avatar profile={profile!} size={24} />
              <span className="flex-1 font-medium">{profile!.name}</span>
              <span className="w-20 text-right font-semibold tabular-nums">
                {formatHoursShort(minutes)}
              </span>
            </div>
          ))}
          {byDesigner.length === 0 && !loading && (
            <div className="px-4 py-6 text-center text-sm text-faint">
              No hours in this range.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
