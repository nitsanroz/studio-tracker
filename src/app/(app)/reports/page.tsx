"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, MoreHorizontal, Plus, Send, Trash2, X } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { fetchAll, mapReportLink } from "@/lib/db";
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
import { ReportTable } from "@/components/report-table";
import { buildReportSnapshot } from "@/lib/report-snapshot";
import type { BillingPeriod, Client, ReportLink } from "@/lib/types";

interface ReportEntry {
  id: string; // "" for rows added locally this session (not editable until reload)
  task_id: string;
  user_id: string;
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
            const editable = !!e.id && (isAdmin || e.user_id === currentUserId);
            return (
              <div
                key={e.id || `${e.date}-${i}`}
                className="flex items-center gap-2.5 border-b border-border py-2 text-sm last:border-b-0"
              >
                <Avatar profile={user} size={24} />
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

// ── billing periods editor (per selected client) ───────────────────────────

function PeriodsEditor({ client }: { client: Client }) {
  const { billingPeriods, addBillingPeriod, updateBillingPeriod, deleteBillingPeriod } = useData();
  const periods = billingPeriods.filter((p) => p.clientId === client.id);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", from: "", to: "", cap: "", advance: "" });

  function submit() {
    if (!form.label.trim() || !form.from || !form.to) return;
    addBillingPeriod({
      clientId: client.id,
      label: form.label.trim(),
      dateFrom: form.from,
      dateTo: form.to,
      hourCap: form.cap ? Number(form.cap) : null,
      advanceHours: form.advance ? Number(form.advance) : null,
    });
    setForm({ label: "", from: "", to: "", cap: "", advance: "" });
    setAdding(false);
  }

  return (
    <details className="rounded-xl border border-border bg-background/60 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted">
        Payment periods ({periods.length}) — define the report&apos;s month columns
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        {periods.map((p) => (
          <PeriodRow key={p.id} period={p} onUpdate={updateBillingPeriod} onDelete={deleteBillingPeriod} />
        ))}
        {adding ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <input
              autoFocus
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Label (e.g. Dec 16 – Jan 15)"
              className="w-44 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
            />
            <input type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs" />
            <span className="text-faint">→</span>
            <input type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs" />
            <input value={form.cap} onChange={(e) => setForm((f) => ({ ...f, cap: e.target.value }))} placeholder="cap h" className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-xs" />
            <input value={form.advance} onChange={(e) => setForm((f) => ({ ...f, advance: e.target.value }))} placeholder="adv h" className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-xs" />
            <button onClick={submit} className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark">Add</button>
            <button onClick={() => setAdding(false)} className="rounded-md px-1.5 py-1 text-xs text-muted hover:bg-background">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="self-start rounded-md border border-dashed border-border-strong px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand"
          >
            + Add period
          </button>
        )}
      </div>
    </details>
  );
}

function PeriodRow({
  period,
  onUpdate,
  onDelete,
}: {
  period: BillingPeriod;
  onUpdate: (id: string, patch: Partial<BillingPeriod>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex flex-wrap items-center gap-1.5 text-sm">
      <input
        defaultValue={period.label}
        onBlur={(e) => e.target.value.trim() && e.target.value !== period.label && onUpdate(period.id, { label: e.target.value.trim() })}
        className="w-44 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border focus:border-brand"
      />
      <input type="date" defaultValue={period.dateFrom} onBlur={(e) => e.target.value && e.target.value !== period.dateFrom && onUpdate(period.id, { dateFrom: e.target.value })} className="rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-border" />
      <span className="text-faint">→</span>
      <input type="date" defaultValue={period.dateTo} onBlur={(e) => e.target.value && e.target.value !== period.dateTo && onUpdate(period.id, { dateTo: e.target.value })} className="rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-border" />
      <input
        defaultValue={period.hourCap ?? ""}
        placeholder="cap"
        onBlur={(e) => onUpdate(period.id, { hourCap: e.target.value ? Number(e.target.value) : null })}
        className="w-14 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs tabular-nums hover:border-border"
        title="Hour cap for this period"
      />
      <input
        defaultValue={period.advanceHours ?? ""}
        placeholder="adv"
        onBlur={(e) => onUpdate(period.id, { advanceHours: e.target.value ? Number(e.target.value) : null })}
        className="w-14 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs tabular-nums hover:border-border"
        title="Advance hours"
      />
      <button
        onClick={() => onDelete(period.id)}
        className="invisible rounded p-1 text-faint hover:text-danger group-hover:visible"
        title="Delete period"
      >
        <Trash2 size={12} />
      </button>
    </div>
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
    const map = new Map<string, number>();
    for (const e of enriched) map.set(e.user_id, (map.get(e.user_id) ?? 0) + e.minutes);
    return [...map.entries()]
      .map(([id, minutes]) => ({ profile: profiles.find((p) => p.id === id), minutes }))
      .filter((r) => r.profile)
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
    <div className="grid items-start gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-4 text-center">
        <div className="text-4xl font-bold tabular-nums text-brand">
          {productivity == null ? "–" : `${productivity}%`}
        </div>
        <div className="mt-1 text-xs text-muted">billable share in this period</div>
        <div className="mt-2">
          <SplitBar billable={billable} nonBillable={total - billable} maxMinutes={total} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-faint">
          <span>{formatHoursShort(billable)} billable</span>
          <span>{formatHoursShort(total - billable)} non-bill.</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Hours in period
        </h3>
        <MiniColumns points={buckets} />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint">Hours by user</h3>
        {byUser.map(({ profile, minutes }) => (
          <HBar
            key={profile!.id}
            label={
              <span className="flex items-center gap-1.5">
                <Avatar profile={profile!} size={16} />
                {profile!.name}
              </span>
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

// ── publish workspace ───────────────────────────────────────────────────────

const HIDDEN_TABS_KEY = "reports.hiddenTabs";

function PublishWorkspace() {
  const { clients, sections, tasks, entrySums, billingPeriods, currentUserId } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<Map<string, ReportLink>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // load links + hidden tabs once
  useEffect(() => {
    fetchAll<Record<string, unknown>>(supabase, "report_links", "*", (q) => q.eq("active", true))
      .then((rows) => {
        const map = new Map<string, ReportLink>();
        for (const r of rows) {
          const link = mapReportLink(r);
          // keep the most recently created active link per client
          const cur = map.get(link.clientId);
          if (!cur || link.createdAt > cur.createdAt) map.set(link.clientId, link);
        }
        setLinks(map);
      })
      .catch((e) => console.error("links load failed", e));
    try {
      const raw = localStorage.getItem(HIDDEN_TABS_KEY);
      if (raw) setHiddenTabs(JSON.parse(raw));
    } catch {}
  }, [supabase]);

  // candidate tabs: recent activity or an existing link
  const taskClient = useMemo(() => new Map(tasks.map((t) => [t.id, t.clientId])), [tasks]);
  const candidates = useMemo(() => {
    const cutoff = toISODate(new Date(Date.now() - 90 * 86400000));
    const activeIds = new Set<string>();
    for (const e of entrySums) {
      if (e.date >= cutoff) {
        const cid = taskClient.get(e.taskId);
        if (cid) activeIds.add(cid);
      }
    }
    for (const [cid] of links) activeIds.add(cid);
    return clients
      .filter((c) => !c.archived && activeIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, entrySums, taskClient, links]);

  const visibleTabs = candidates.filter((c) => !hiddenTabs.includes(c.id));
  const selectedClient =
    clients.find((c) => c.id === selected) ?? visibleTabs[0] ?? null;

  // sync hide-state when switching client
  useEffect(() => {
    if (!selectedClient) return;
    const link = links.get(selectedClient.id);
    setHiddenColumns(link?.hiddenColumns ?? []);
    setHiddenTaskIds(link?.hiddenTaskIds ?? []);
  }, [selectedClient?.id, links]); // eslint-disable-line react-hooks/exhaustive-deps

  function persistHiddenTabs(next: string[]) {
    setHiddenTabs(next);
    try {
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next));
    } catch {}
  }

  const preview = useMemo(() => {
    if (!selectedClient) return null;
    return buildReportSnapshot(
      selectedClient,
      sections,
      tasks,
      entrySums,
      billingPeriods.filter((p) => p.clientId === selectedClient.id),
    );
  }, [selectedClient, sections, tasks, entrySums, billingPeriods]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function ensureLink(clientId: string): Promise<ReportLink | null> {
    const existing = links.get(clientId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from("report_links")
      .insert({ client_id: clientId, created_by: currentUserId })
      .select()
      .single();
    if (error) {
      console.error("create link failed", error.message);
      return null;
    }
    const link = mapReportLink(data);
    setLinks((prev) => new Map(prev).set(clientId, link));
    return link;
  }

  async function publish() {
    if (!selectedClient || !preview) return;
    setPublishing(true);
    const link = await ensureLink(selectedClient.id);
    if (!link) {
      setPublishing(false);
      return;
    }
    const publishedAt = new Date().toISOString();
    const { error } = await supabase
      .from("report_links")
      .update({
        snapshot: preview,
        published_at: publishedAt,
        hidden_columns: hiddenColumns,
        hidden_task_ids: hiddenTaskIds,
      })
      .eq("id", link.id);
    setPublishing(false);
    if (error) {
      console.error("publish failed", error.message);
      showToast("Publish failed — check console");
      return;
    }
    const updated = { ...link, snapshot: preview, publishedAt, hiddenColumns, hiddenTaskIds };
    setLinks((prev) => new Map(prev).set(selectedClient.id, updated));
    await navigator.clipboard.writeText(`${window.location.origin}/report/${link.token}`);
    showToast("Report published — link copied to clipboard");
  }

  async function copyLink() {
    if (!selectedClient) return;
    const link = await ensureLink(selectedClient.id);
    if (!link) return;
    await navigator.clipboard.writeText(`${window.location.origin}/report/${link.token}`);
    showToast("Link to report copied to clipboard");
  }

  const currentLink = selectedClient ? links.get(selectedClient.id) : undefined;
  const lastPublished = currentLink?.publishedAt
    ? new Date(currentLink.publishedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold tracking-tight">Client reports</h2>

      {/* tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {visibleTabs.map((c) => (
          <span key={c.id} className="group relative">
            <button
              onClick={() => setSelected(c.id)}
              className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium ${
                selectedClient?.id === c.id
                  ? "border-border bg-surface text-foreground"
                  : "border-transparent bg-transparent text-muted hover:text-foreground"
              }`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
              {links.get(c.id)?.publishedAt && (
                <span className="size-1.5 rounded-full bg-success" title="Published" />
              )}
            </button>
            <button
              onClick={() => persistHiddenTabs([...hiddenTabs, c.id])}
              className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-foreground text-white group-hover:flex"
              title="Hide tab"
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <div className="relative">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="rounded-lg px-2 py-1.5 text-muted hover:bg-background"
            title="More clients"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
              <div className="absolute left-0 top-full z-40 max-h-72 w-56 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
                {clients
                  .filter((c) => !c.archived && (hiddenTabs.includes(c.id) || !candidates.some((x) => x.id === c.id)))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        persistHiddenTabs(hiddenTabs.filter((id) => id !== c.id));
                        setSelected(c.id);
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background"
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedClient && preview ? (
        <div className="grid items-start gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={publish}
                disabled={publishing}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <Send size={14} />
                {publishing ? "Publishing…" : "Publish"}
              </button>
              <button
                onClick={copyLink}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand"
              >
                <Copy size={14} /> Copy link
              </button>
              <span className="text-xs text-muted">
                {lastPublished ? (
                  <span className="flex items-center gap-1">
                    <Check size={12} className="text-success" /> Last published {lastPublished}
                  </span>
                ) : (
                  "Never published — clients see nothing until you publish."
                )}
              </span>
            </div>

            <PeriodsEditor client={selectedClient} />

            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-[11px] text-faint">
                Preview — use the eye toggles to hide rows/columns from the client&apos;s default
                view. Publishing freezes this exact data.
              </p>
              <ReportTable
                snapshot={preview}
                hiddenColumns={hiddenColumns}
                hiddenTaskIds={hiddenTaskIds}
                editable
                onToggleColumn={(key) =>
                  setHiddenColumns((prev) =>
                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                  )
                }
                onToggleTask={(id) =>
                  setHiddenTaskIds((prev) =>
                    prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
                  )
                }
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-faint">
          No clients with recent activity. Use ⋯ to pick one.
        </p>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-white shadow-xl">
          {toast}
        </div>
      )}
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
      "id, task_id, user_id, date, minutes, description",
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
            esc(profileById.get(e.user_id)?.name ?? ""),
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

      {/* ── stats for the selected period + filters ── */}
      <RangeStats enriched={enriched} profiles={profiles} />

      {/* ── per-client expandable table with billable split graph ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="flex-1">Client</span>
          <span className="w-40">Billable split</span>
          <span className="w-20 text-right">Billable</span>
          <span className="w-20 text-right">Non-bill.</span>
          <span className="w-20 text-right">Total</span>
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

      <PublishWorkspace />

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
