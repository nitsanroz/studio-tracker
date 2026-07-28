"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search } from "lucide-react";
import { useData } from "@/lib/store";
import { formatHoursShort } from "@/lib/format";
import { presetRange } from "@/lib/date-ranges";
import { latestActivityByClient, minutesByClientInRange } from "@/lib/aggregate";
import { useColWidths, ResizeHandle } from "@/components/resizable";
import { EditableTextCell } from "@/components/editable-cell";

type SortKey = "client" | "open" | "week" | "month" | "total";
type Sort = { key: SortKey; dir: 1 | -1 } | null;

const SORT_HINTS: Record<SortKey, string> = {
  client: "Client name — click a name to rename it. Click to sort",
  open: "Tasks not yet done. Click to sort",
  week: "Hours logged this week. Click to sort",
  month: "Hours logged this month. Click to sort",
  total: "All hours ever logged. Click to sort",
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "right",
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === k;
  const Icon = active ? (sort!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      onClick={() => onSort(k)}
      className={`group/sort inline-flex items-center gap-1 uppercase tracking-wide ${
        align === "right" ? "justify-end" : "justify-start"
      } ${active ? "text-brand" : "text-faint hover:text-muted"} ${className}`}
      title={SORT_HINTS[k] ?? `Sort by ${label.toLowerCase()}`}
    >
      {label}
      <Icon
        size={12}
        className={active ? "" : "opacity-0 transition-opacity group-hover/sort:opacity-100"}
      />
    </button>
  );
}

function CreateClientModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { addClient } = useData();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0b43ed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const client = await addClient(name.trim(), color, note.trim() || undefined);
    setBusy(false);
    if (!client) {
      setError("Could not create client — try again.");
      return;
    }
    onClose();
    router.push(`/clients/${client.id}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="fixed left-1/2 top-1/3 z-[70] flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-2xl"
      >
        <h3 className="font-heading text-sm">New client</h3>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Client name"
            className="bidi-auto rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal text-foreground outline-none focus:border-brand"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded-md border border-border bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Billing period note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="e.g. monthly retainer, 20h"
            className="bidi-auto rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal text-foreground outline-none focus:border-brand"
          />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create client"}
          </button>
        </div>
      </form>
    </>
  );
}

export default function ClientsPage() {
  const { clients, tasks, entrySumsAll, profiles, currentUserId, updateClient } = useData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [creating, setCreating] = useState(false);

  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const taskClient = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.clientId])),
    [tasks],
  );
  const week = useMemo(() => presetRange("This week"), []);
  const month = useMemo(() => presetRange("This month"), []);
  const weekMinutes = useMemo(
    () => minutesByClientInRange(entrySumsAll, week.from, week.to, taskClient),
    [entrySumsAll, week, taskClient],
  );
  const monthMinutes = useMemo(
    () => minutesByClientInRange(entrySumsAll, month.from, month.to, taskClient),
    [entrySumsAll, month, taskClient],
  );
  const totalMinutes = useMemo(
    () => minutesByClientInRange(entrySumsAll, "0000-01-01", "9999-12-31", taskClient),
    [entrySumsAll, taskClient],
  );
  const lastActivity = useMemo(
    () => latestActivityByClient(entrySumsAll, taskClient),
    [entrySumsAll, taskClient],
  );

  // click = asc, again = desc, third = back to default (latest activity)
  const cycleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null,
    );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = clients
      .filter((c) => !c.archived && (q === "" || c.name.toLowerCase().includes(q)))
      .map((client) => ({
        client,
        openTasks: tasks.filter((t) => t.clientId === client.id && t.status !== "done").length,
        week: weekMinutes.get(client.id) ?? 0,
        month: monthMinutes.get(client.id) ?? 0,
        total: totalMinutes.get(client.id) ?? 0,
        last: lastActivity.get(client.id) ?? "",
      }))
      // default: latest activity first
      .sort((a, b) => b.last.localeCompare(a.last) || b.openTasks - a.openTasks);
    if (sort) {
      const { key, dir } = sort;
      list.sort((a, b) => {
        if (key === "client") return a.client.name.localeCompare(b.client.name) * dir;
        const map = { open: "openTasks", week: "week", month: "month", total: "total" } as const;
        return (a[map[key]] - b[map[key]]) * dir;
      });
    }
    return list;
  }, [clients, tasks, weekMinutes, monthMinutes, totalMinutes, lastActivity, query, sort]);

  const { widths, startResize } = useColWidths("clients", { open: 48, week: 64, month: 64, total: 64 });

  const numCell = (minutes: number, width: number) => (
    <span
      className={`shrink-0 text-right text-sm font-medium tabular-nums ${minutes ? "" : "text-faint"}`}
      style={{ width }}
    >
      {minutes ? formatHoursShort(minutes) : "–"}
    </span>
  );

  if (!isAdmin) {
    return <p className="text-sm text-muted">Clients are for admins only.</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[650px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl">Clients</h1>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-sm font-medium text-white hover:bg-brand-dark"
          >
            <Plus size={14} />
            Create new client
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3">
        <Search size={15} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="bidi-auto h-9 w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="group/thead flex items-center gap-3 border-b border-border bg-background px-3 py-2 text-xs font-medium">
          <span className="min-w-0 flex-1">
            <SortHeader label="Client" k="client" sort={sort} onSort={cycleSort} align="left" />
          </span>
          {(
            [
              ["open", "Open"],
              ["week", "Week"],
              ["month", "Month"],
              ["total", "Total"],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="relative flex shrink-0 justify-end" style={{ width: widths[k] }}>
              <SortHeader label={label} k={k} sort={sort} onSort={cycleSort} />
              <ResizeHandle onMouseDown={startResize(k)} />
            </span>
          ))}
        </div>
        {rows.map(({ client, openTasks, week, month, total }) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            className="flex items-center gap-3 border-b border-border px-3 py-2 transition-colors last:border-b-0 hover:bg-background"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: client.color }}
              >
                {client.name[0]}
              </span>
              <span className="min-w-0 flex-1">
                <EditableTextCell
                  value={client.name}
                  onCommit={(v) => v && updateClient(client.id, { name: v })}
                  className="text-sm font-semibold"
                  inputClassName="text-sm font-semibold"
                />
                {client.billingPeriodNote && (
                  <span className="block truncate px-1.5 text-xs text-faint">{client.billingPeriodNote}</span>
                )}
              </span>
            </span>
            <span
              className={`shrink-0 text-right text-sm font-medium tabular-nums ${openTasks ? "" : "text-faint"}`}
              style={{ width: widths.open }}
            >
              {openTasks || "–"}
            </span>
            {numCell(week, widths.week)}
            {numCell(month, widths.month)}
            {numCell(total, widths.total)}
          </Link>
        ))}
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-faint">No clients match &quot;{query}&quot;.</div>
        )}
      </div>

      {creating && <CreateClientModal onClose={() => setCreating(false)} />}
    </div>
  );
}
