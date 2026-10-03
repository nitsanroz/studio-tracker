"use client";

// Settings → Leads → Service library + pricing (Phase 4).
//
// The items an estimate line is picked from, with their usual hour ranges —
// seeded by 0045 from the Unibeam scope doc. Beside each range: the AVERAGE
// hours actually logged on won projects whose task came from that item (US21),
// so a range that keeps being blown is visible where it is set.
//
// ⚠️ ITEMS ARE RETIRED, NOT DELETED: an estimate line keeps pointing at its
// library item for the actual-hours feedback, and an old v2 must still say
// which item it came from.

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { CATEGORIES, type Category, type ServiceItem } from "@/lib/leads/estimate";
import {
  addLibraryItem,
  loadLibrary,
  loadLibraryActuals,
  loadPricing,
  savePricing,
  updateLibraryItem,
} from "@/lib/leads/estimates-data";

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const QUIET =
  "rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:bg-surface focus:outline-none";

function Num({ value, onCommit, className = "" }: { value: number | null; onCommit: (v: number | null) => void; className?: string }) {
  return (
    <input
      type="number"
      min={0}
      step={0.5}
      key={String(value)}
      defaultValue={value ?? ""}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === "" ? null : Number(raw);
        if (v !== value && (v === null || Number.isFinite(v))) onCommit(v);
      }}
      className={`${QUIET} w-16 text-right tabular-nums ${className}`}
    />
  );
}

export function LibrarySettings() {
  const [items, setItems] = useState<ServiceItem[] | null>(null);
  const [actuals, setActuals] = useState<Map<string, { avg: number; n: number }>>(new Map());
  const [pricing, setPricing] = useState<{ rate: number; vatPercent: number } | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [i, a, p] = await Promise.all([loadLibrary(), loadLibraryActuals(), loadPricing()]);
    setItems(i);
    setActuals(a);
    setPricing(p);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [i, a, p] = await Promise.all([loadLibrary(), loadLibraryActuals(), loadPricing()]);
      if (!alive) return;
      setItems(i);
      setActuals(a);
      setPricing(p);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    }
  };

  if (!items || !pricing) return null;
  const shown = items.filter((i) => showRetired || i.active);

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-sm font-semibold">Service library &amp; pricing</h3>
        <span className="text-xs text-muted">
          Estimate lines are picked from here. Changing a range affects new lines only — existing estimates keep
          their numbers.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
        <label className="flex items-center gap-1.5">
          Rate
          <Num value={pricing.rate} onCommit={(v) => void run(() => savePricing(v ?? 350, pricing.vatPercent))} />
          NIS/h
        </label>
        <label className="flex items-center gap-1.5">
          VAT
          <Num value={pricing.vatPercent} onCommit={(v) => void run(() => savePricing(pricing.rate, v ?? 18))} />%
        </label>
        <span className="text-[11.5px] text-faint">Used for new estimates; each estimate can override its own.</span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_110px_190px_130px_70px] gap-2 border-b border-border pb-1 text-[11px] uppercase tracking-wide text-faint">
        <span>Item</span>
        <span>Category</span>
        <span className="text-right">Usual hours</span>
        <span className="text-right" title="Average hours logged on won projects' tasks made from this item">
          Actual (avg)
        </span>
        <span />
      </div>
      {shown.map((i) => {
        const a = actuals.get(i.id);
        return (
          <div
            key={i.id}
            className={`grid grid-cols-[1fr_110px_190px_130px_70px] items-start gap-2 border-b border-border/50 py-1.5 ${
              i.active ? "" : "opacity-50"
            }`}
          >
            <div className="min-w-0">
              <input
                key={i.name}
                defaultValue={i.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== i.name) void run(() => updateLibraryItem(i.id, { name: v }));
                }}
                className={`${QUIET} w-full text-[13px] font-medium`}
              />
              <textarea
                key={i.description ?? ""}
                defaultValue={i.description ?? ""}
                rows={1}
                placeholder="Default client-facing description"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== i.description) void run(() => updateLibraryItem(i.id, { description: v }));
                }}
                // The resize corner only on hover/focus — at rest it is clutter on
                // every row of the library (Nitsan, 2026-10-03).
                className={`${QUIET} w-full resize-none text-[12px] text-muted hover:resize-y focus:resize-y`}
              />
            </div>
            <select
              value={i.category}
              onChange={(e) => void run(() => updateLibraryItem(i.id, { category: e.target.value as Category }))}
              className={`${QUIET} text-[12.5px] text-muted`}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-1 text-[13px]">
              {i.kind === "percent" ? (
                <>
                  +<Num value={i.percent} onCommit={(v) => void run(() => updateLibraryItem(i.id, { percent: v }))} />
                  <span className="text-[11.5px] text-faint">% of</span>
                  <select
                    value={i.percentOf ?? "website"}
                    onChange={(e) => void run(() => updateLibraryItem(i.id, { percentOf: e.target.value as Category }))}
                    className={`${QUIET} text-[12px]`}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <Num value={i.minHours} onCommit={(v) => void run(() => updateLibraryItem(i.id, { minHours: v }))} />
                  <span className="text-faint">–</span>
                  <Num value={i.maxHours} onCommit={(v) => void run(() => updateLibraryItem(i.id, { maxHours: v }))} />
                  <span className="text-[11.5px] text-faint">h</span>
                </>
              )}
            </div>
            <span className="pt-1 text-right text-[12.5px] tabular-nums text-muted">
              {a ? `${a.avg.toFixed(1)} h · ${a.n} job${a.n === 1 ? "" : "s"}` : "—"}
            </span>
            <button
              onClick={() => void run(() => updateLibraryItem(i.id, { active: !i.active }))}
              className="pt-1 text-right text-[12px] text-faint hover:text-foreground"
            >
              {i.active ? "Retire" : "Restore"}
            </button>
          </div>
        );
      })}
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void run(() => addLibraryItem(Math.max(0, ...items.map((i) => i.position)) + 1))}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={13} /> Add an item
        </button>
        {items.some((i) => !i.active) && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show retired
          </label>
        )}
      </div>
    </div>
  );
}
