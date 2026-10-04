"use client";

// The estimate's scope — phases → groups → lines, the client page's
// section → group → task hierarchy, so a won lead converts 1:1 (0049).
//
// Behaves like the client task list: drag a line within or between groups and
// phases, drag a group (its lines go with it), drag a phase; "Add item" at the
// end of every group and phase, "Add group" per phase; groups fold. Groups sit
// first in a phase, then its loose lines — the client page's order.
//
// ⚠️ ONLY THE GRIP IS DRAGGABLE, never the row: every row is full of inputs,
// and a draggable ancestor fights text selection in them (the bug the client
// table hit — v0.99.26). The grip hands the whole row to `setDragImage`.
//
// ⚠️ `drag` is module state because the element deciding whether to accept a
// drop is a different element from the one being dragged, and `getData()` is
// unreadable during `dragover` — the same reason as the client table's.

import { useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, FolderPlus, GripVertical, Plus, Trash2 } from "lucide-react";
import { askConfirm } from "@/components/confirm-dialog";
import {
  addGroup,
  addLine,
  addPhase,
  chooseAlternative,
  moveGroup,
  moveLine,
  movePhase,
  removeGroup,
  removeLine,
  removePhase,
  renameGroup,
  updateLine,
  updatePhase,
  type EstimateDetail,
} from "@/lib/leads/estimates-data";
import {
  CATEGORIES,
  counts,
  fmtHours,
  fmtNis,
  groupWinners,
  phaseLayout,
  type Category,
  type EstimateLine,
  type Range,
  type ServiceItem,
  type Totals,
} from "@/lib/leads/estimate";
import { NumField, QUIET, TextField } from "./estimate-fields";

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const COLS = "grid grid-cols-[16px_1fr_110px_150px_150px_24px] gap-2";

type Drag = { kind: "line" | "group" | "phase"; id: string };
/** A property, not a reassigned `let`: a module binding written from a component is a lint error. */
const dnd: { drag: Drag | null } = { drag: null };

type Edge = "before" | "after" | "inside";
const edgeOf = (e: DragEvent<HTMLElement>): "before" | "after" => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? "before" : "after";
};
const MARK: Record<Edge, string> = {
  before: "shadow-[inset_0_2px_0_var(--brand)]",
  after: "shadow-[inset_0_-2px_0_var(--brand)]",
  inside: "ring-2 ring-brand ring-inset",
};

/** The id that follows `id` in `list` once `moving` is taken out — the "before" anchor for an after-drop. */
function nextAfter(list: { id: string }[], id: string, moving: string): string | null {
  const rest = list.filter((x) => x.id !== moving);
  const i = rest.findIndex((x) => x.id === id);
  return rest[i + 1]?.id ?? null;
}

function Grip({ label, onStart, onEnd }: { label: string; onStart: (e: DragEvent<HTMLElement>) => void; onEnd: () => void }) {
  return (
    <span
      draggable
      onDragStart={onStart}
      onDragEnd={onEnd}
      aria-label={label}
      title="Drag to move"
      className="flex h-6 cursor-grab items-center text-faint opacity-0 hover:text-foreground group-hover/row:opacity-100 active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </span>
  );
}

export function EstimateScope({
  detail,
  t,
  library,
  locked,
  run,
}: {
  detail: EstimateDetail;
  t: Totals;
  library: ServiceItem[];
  locked: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const e = detail.estimate;
  const winners = groupWinners(detail.lines);
  const [over, setOver] = useState<{ key: string; edge: Edge } | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const money = (r: Range) => fmtNis({ min: r.min * e.rate, max: r.max * e.rate });
  const sumOf = (lines: EstimateLine[]) =>
    lines.reduce<Range>(
      (acc, l) => {
        if (!counts(l, winners)) return acc;
        const h = t.hours.get(l.id) ?? { min: 0, max: 0 };
        return { min: acc.min + h.min, max: acc.max + h.max };
      },
      { min: 0, max: 0 },
    );

  const begin = (d: Drag) => (ev: DragEvent<HTMLElement>) => {
    dnd.drag = d;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", d.id);
    const row = ev.currentTarget.closest("[data-drag-row]");
    if (row instanceof HTMLElement) ev.dataTransfer.setDragImage(row, 16, 16);
  };
  const end = () => {
    dnd.drag = null;
    setOver(null);
  };
  /** Wire a drop target: `accept` returns the edge to show, or null to refuse. */
  const target = (key: string, accept: (d: Drag, ev: DragEvent<HTMLElement>) => Edge | null, drop: (d: Drag, edge: Edge) => void) =>
    locked
      ? {}
      : {
          onDragOver: (ev: DragEvent<HTMLElement>) => {
            const d = dnd.drag;
            const edge = d ? accept(d, ev) : null;
            if (!edge) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (over?.key !== key || over.edge !== edge) setOver({ key, edge });
          },
          onDragLeave: (ev: DragEvent<HTMLElement>) => {
            if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver((o) => (o?.key === key ? null : o));
          },
          onDrop: (ev: DragEvent<HTMLElement>) => {
            const d = dnd.drag;
            const edge = d ? accept(d, ev) : null;
            if (!d || !edge) return;
            ev.preventDefault();
            ev.stopPropagation();
            end();
            drop(d, edge);
          },
        };
  const mark = (key: string) => (over?.key === key ? MARK[over.edge] : "");

  const addItem = (phaseId: string, groupId: string | null, count: number) => (
    <select
      value=""
      onChange={(ev) => {
        const v = ev.target.value;
        if (!v) return;
        const item = v === "blank" ? null : (library.find((i) => i.id === v) ?? null);
        void run(() => addLine(e.id, phaseId, item, count + 1, groupId));
      }}
      className="rounded-md border border-dashed border-border-strong bg-surface px-2 py-1 text-[12.5px] text-muted"
      aria-label="Add an item"
    >
      <option value="">+ Add item…</option>
      {CATEGORIES.map((c) => {
        const items = library.filter((i) => i.category === c.value);
        return items.length ? (
          <optgroup key={c.value} label={c.label}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.kind === "percent" ? ` (+${i.percent}% of ${i.percentOf})` : ` (${i.minHours}–${i.maxHours}h)`}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
      <option value="blank">Blank item</option>
    </select>
  );

  const lineRow = (l: EstimateLine, phaseId: string, groupId: string | null, container: EstimateLine[]) => {
    const h = t.hours.get(l.id) ?? { min: 0, max: 0 };
    const isWinner = Boolean(l.altGroup) && winners.get(l.altGroup!) === l.id;
    const outOfTotal = l.optional || (l.altGroup && !isWinner);
    const actual = l.taskId ? detail.actual.get(l.taskId) : undefined;
    const key = `l:${l.id}`;
    return (
      <div
        key={l.id}
        data-drag-row
        {...target(
          key,
          (d, ev) => (d.kind === "line" && d.id !== l.id ? edgeOf(ev) : null),
          (d, edge) =>
            void run(() =>
              moveLine(e.id, d.id, { phaseId, groupId, beforeId: edge === "before" ? l.id : nextAfter(container, l.id, d.id) }),
            ),
        )}
        className={`group/row ${COLS} items-start border-t border-border/60 bg-surface py-2 ${mark(key)} ${outOfTotal ? "opacity-60" : ""}`}
      >
        {locked ? <span /> : <Grip label={`Move ${l.name}`} onStart={begin({ kind: "line", id: l.id })} onEnd={end} />}
        <div className={`min-w-0 ${groupId ? "pl-5" : ""}`}>
          <div className="flex items-center gap-1.5">
            {l.altGroup && (
              <input
                type="radio"
                name={`alt-${l.altGroup}`}
                checked={isWinner}
                disabled={locked}
                onChange={() => void run(() => chooseAlternative(e.id, l.altGroup!, l.id))}
                title="The option counted in the total"
              />
            )}
            <TextField
              value={l.name}
              disabled={locked}
              onCommit={(v) => void run(() => updateLine(e.id, l.id, { name: v ?? "Untitled" }))}
              className="w-full text-[13.5px] font-medium"
            />
          </div>
          <TextField
            value={l.description}
            disabled={locked}
            multiline
            placeholder={locked ? "" : "Client-facing description (optional)"}
            onCommit={(v) => void run(() => updateLine(e.id, l.id, { description: v }))}
            className="mt-0.5 w-full resize-y text-[12px] text-muted"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11.5px] text-faint">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={l.optional}
                disabled={locked}
                onChange={(ev) => void run(() => updateLine(e.id, l.id, { optional: ev.target.checked }))}
              />
              Optional extra
            </label>
            <label className="flex items-center gap-1" title="Items with the same option group are 'choose one'">
              Choose-one group
              <TextField
                value={l.altGroup}
                disabled={locked}
                placeholder="—"
                // ⚠️ Joining a group is "chosen" only if nothing else in it is —
                // otherwise both options land in the total (found in testing:
                // workshop AND alignment session counted, 140–216h).
                onCommit={(v) =>
                  void run(() =>
                    updateLine(e.id, l.id, {
                      altGroup: v,
                      chosen: !v || !detail.lines.some((o) => o.id !== l.id && o.altGroup === v && o.chosen),
                    }),
                  )
                }
                className="w-24 text-[11.5px]"
              />
            </label>
            {actual !== undefined && <span className="text-[#12693d]">Actual: {actual.toFixed(1)} h logged</span>}
          </div>
        </div>
        <select
          value={l.category}
          disabled={locked}
          onChange={(ev) => void run(() => updateLine(e.id, l.id, { category: ev.target.value as Category }))}
          className={`${QUIET} text-[12px] text-muted`}
          aria-label="Category"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-end gap-1 text-[13px]">
          {l.kind === "percent" ? (
            <>
              <NumField
                value={l.percent}
                disabled={locked}
                onCommit={(v) => void run(() => updateLine(e.id, l.id, { percent: v }))}
                className="w-14"
              />
              <span className="text-[11.5px] text-faint">% of {l.percentOf}</span>
            </>
          ) : (
            <>
              <NumField
                value={l.minHours}
                disabled={locked}
                onCommit={(v) => void run(() => updateLine(e.id, l.id, { minHours: v }))}
                className="w-14"
                step={0.5}
              />
              <span className="text-faint">–</span>
              <NumField
                value={l.maxHours}
                disabled={locked}
                onCommit={(v) => void run(() => updateLine(e.id, l.id, { maxHours: v }))}
                className="w-14"
                step={0.5}
              />
              <span className="text-[11.5px] text-faint">h</span>
            </>
          )}
        </div>
        <div className="pt-1 text-right text-[12.5px] tabular-nums">
          {l.kind === "percent" && <div className="text-[11.5px] text-faint">{fmtHours(h)}</div>}
          {money(h)}
          {outOfTotal && <div className="text-[10.5px] text-faint">{l.optional ? "not in total" : "not chosen"}</div>}
        </div>
        {!locked ? (
          <button
            onClick={() => void run(() => removeLine(e.id, l.id))}
            aria-label={`Remove ${l.name}`}
            className="pt-1 text-faint opacity-0 hover:text-danger group-hover/row:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  };

  const phases = [...detail.phases].sort((a, b) => a.position - b.position);

  return (
    <>
      {phases.map((p) => {
        const lay = phaseLayout(p.id, detail.groups, detail.lines);
        const all = [...lay.groups.flatMap((g) => g.lines), ...lay.loose];
        const sub = t.phase.get(p.id) ?? { min: 0, max: 0 };
        const pKey = `p:${p.id}`;
        return (
          <div key={p.id} className={`${CARD} ${mark(pKey)}`}>
            <div
              data-drag-row
              {...target(
                pKey,
                (d, ev) => (d.kind === "phase" ? (d.id === p.id ? null : edgeOf(ev)) : "inside"),
                (d, edge) => {
                  if (d.kind === "phase")
                    void run(() =>
                      movePhase(e.id, d.id, edge === "before" ? p.id : nextAfter(phases, p.id, d.id)),
                    );
                  else if (d.kind === "group") void run(() => moveGroup(e.id, d.id, { phaseId: p.id, beforeId: null }));
                  else void run(() => moveLine(e.id, d.id, { phaseId: p.id, groupId: null, beforeId: null }));
                },
              )}
              className="group/row flex items-center gap-2"
            >
              {!locked && <Grip label={`Move ${p.name}`} onStart={begin({ kind: "phase", id: p.id })} onEnd={end} />}
              <TextField
                value={p.name}
                disabled={locked}
                onCommit={(v) => void run(() => updatePhase(e.id, p.id, { name: v ?? "Phase" }))}
                className="min-w-0 flex-1 text-[15px] font-semibold"
              />
              <span className="text-[12.5px] tabular-nums text-muted">
                {fmtHours(sub)} · {money(sub)}
              </span>
              {!locked && (
                <button
                  onClick={async () => {
                    if (await askConfirm(`Remove ${p.name} and its ${all.length} items?`, { action: "Remove", danger: true }))
                      void run(() => removePhase(e.id, p.id));
                  }}
                  aria-label={`Remove ${p.name}`}
                  className="text-faint hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <TextField
              value={p.description}
              disabled={locked}
              multiline
              placeholder={locked ? "" : "Phase description (optional)"}
              onCommit={(v) => void run(() => updatePhase(e.id, p.id, { description: v }))}
              className="mt-1 w-full resize-y text-[12.5px] text-muted"
            />
            <div className={`mt-2 ${COLS} text-[11px] uppercase tracking-wide text-faint`}>
              <span />
              <span>Item</span>
              <span>Category</span>
              <span className="text-right">Hours</span>
              <span className="text-right">NIS</span>
              <span />
            </div>

            {lay.groups.map(({ group: g, lines }) => {
              const gKey = `g:${g.id}`;
              const open = !folded.has(g.id);
              const gs = sumOf(lines);
              return (
                <div key={g.id}>
                  <div
                    data-drag-row
                    {...target(
                      gKey,
                      (d, ev) => (d.kind === "line" ? "inside" : d.kind === "group" && d.id !== g.id ? edgeOf(ev) : null),
                      (d, edge) => {
                        if (d.kind === "line")
                          void run(() => moveLine(e.id, d.id, { phaseId: p.id, groupId: g.id, beforeId: null }));
                        else
                          void run(() =>
                            moveGroup(e.id, d.id, {
                              phaseId: p.id,
                              beforeId:
                                edge === "before"
                                  ? g.id
                                  : nextAfter(
                                      lay.groups.map((x) => x.group),
                                      g.id,
                                      d.id,
                                    ),
                            }),
                          );
                      },
                    )}
                    className={`group/row ${COLS} items-center border-t border-border/60 bg-background/60 py-1.5 ${mark(gKey)}`}
                  >
                    {locked ? <span /> : <Grip label={`Move ${g.name}`} onStart={begin({ kind: "group", id: g.id })} onEnd={end} />}
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        onClick={() =>
                          setFolded((s) => {
                            const n = new Set(s);
                            if (n.has(g.id)) n.delete(g.id);
                            else n.add(g.id);
                            return n;
                          })
                        }
                        aria-label={open ? `Fold ${g.name}` : `Unfold ${g.name}`}
                        className="text-faint hover:text-foreground"
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <TextField
                        value={g.name}
                        disabled={locked}
                        onCommit={(v) => void run(() => renameGroup(e.id, g.id, v ?? "Group"))}
                        className="min-w-0 flex-1 text-[13.5px] font-semibold"
                      />
                      <span className="shrink-0 text-[11.5px] text-faint">{lines.length}</span>
                    </div>
                    <span />
                    <span className="text-right text-[12px] tabular-nums text-muted">{fmtHours(gs)}</span>
                    <span className="text-right text-[12px] tabular-nums text-muted">{money(gs)}</span>
                    {!locked ? (
                      <button
                        onClick={() => void run(() => removeGroup(e.id, g.id))}
                        aria-label={`Remove the group ${g.name} — its items stay in the phase`}
                        title="Remove the group — its items stay in the phase"
                        className="text-faint opacity-0 hover:text-danger group-hover/row:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                  {open && lines.map((l) => lineRow(l, p.id, g.id, lines))}
                  {open && !locked && (
                    <div className="border-t border-border/60 py-1.5 pl-[42px]">
                      {addItem(p.id, g.id, lines.length)}
                    </div>
                  )}
                </div>
              );
            })}

            {lay.loose.map((l) => lineRow(l, p.id, null, lay.loose))}

            {!locked && (
              <div
                {...target(
                  `end:${p.id}`,
                  (d) => (d.kind === "line" ? "inside" : null),
                  (d) => void run(() => moveLine(e.id, d.id, { phaseId: p.id, groupId: null, beforeId: null })),
                )}
                className={`mt-1 flex items-center gap-2 border-t border-border/60 pt-2 ${mark(`end:${p.id}`)}`}
              >
                {addItem(p.id, null, lay.loose.length)}
                <button
                  onClick={() => void run(() => addGroup(e.id, p.id, "New group"))}
                  className="flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2 py-1 text-[12.5px] text-muted hover:border-brand hover:text-brand"
                >
                  <FolderPlus size={13} /> Add group
                </button>
              </div>
            )}
          </div>
        );
      })}

      {!locked && (
        <div>
          <button
            onClick={() => void run(() => addPhase(e.id, `Phase ${phases.length + 1}`, phases.length + 1))}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 py-1 text-[12.5px] text-muted hover:border-brand hover:text-brand"
          >
            <Plus size={13} /> Add a phase
          </button>
        </div>
      )}
    </>
  );
}
