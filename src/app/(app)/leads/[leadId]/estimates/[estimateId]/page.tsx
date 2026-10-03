"use client";

// One estimate version — the editor (Leads Phase 4, no AI).
//
// Mirrors the studio's own scope documents (Unibeam, Sep 2026): an intro,
// phases of lines with min–max hours, "choose one" options, optional extras,
// totals "+ VAT", a timeline. Every ₪ figure is CALCULATED (see
// `src/lib/leads/estimate.ts`); there is nowhere to type money.
//
// ⚠️ AN APPROVED VERSION IS READ-ONLY, in the database's actions as well as
// here: "Save as new version" is how it changes.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, Copy, ExternalLink, GitBranchPlus, Plus, Send, Trash2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { SettingsPopupButton } from "@/components/leads/settings-popup";
import { loadLead } from "@/lib/leads/data";
import {
  addLine,
  addPhase,
  approveEstimate,
  chooseAlternative,
  deleteEstimate,
  loadEstimate,
  loadLibrary,
  newVersion,
  publishEstimate,
  removeLine,
  removePhase,
  reopenEstimate,
  submitForReview,
  updateEstimate,
  updateLine,
  updatePhase,
  type EstimateDetail,
} from "@/lib/leads/estimates-data";
import {
  CATEGORIES,
  fmtHours,
  fmtNis,
  groupWinners,
  totals,
  type Category,
  type EstimateLine,
  type ServiceItem,
} from "@/lib/leads/estimate";

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const LABEL = "text-[12px] font-medium uppercase tracking-wider text-faint";
const QUIET =
  "rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:bg-surface focus:outline-none disabled:hover:border-transparent";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-background text-muted" },
  in_review: { label: "In review", cls: "bg-[#fdf3e3] text-[#8a5a09]" },
  approved: { label: "Approved", cls: "bg-[#eaf6ee] text-[#12693d]" },
};

/** A number field that commits on blur; empty → null. */
function NumField({
  value,
  onCommit,
  disabled,
  className = "",
  step = 1,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
  step?: number;
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      key={String(value)}
      defaultValue={value ?? ""}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === "" ? null : Number(raw);
        if (v !== value && (v === null || Number.isFinite(v))) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${QUIET} text-right tabular-nums ${className}`}
    />
  );
}

function TextField({
  value,
  onCommit,
  disabled,
  className = "",
  placeholder,
  multiline,
  rows = 2,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const common = {
    defaultValue: value ?? "",
    disabled,
    placeholder,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value.trim() || null;
      if (v !== (value ?? null)) onCommit(v);
    },
    className: `bidi-auto ${QUIET} ${className}`,
  };
  return multiline ? (
    <textarea key={value ?? ""} rows={rows} {...common} />
  ) : (
    <input key={value ?? ""} {...common} />
  );
}

export default function EstimatePage() {
  const isAdmin = useIsAdmin();
  const { currentUserId, profiles } = useData();
  const router = useRouter();
  const { leadId, estimateId } = useParams<{ leadId: string; estimateId: string }>();

  const [detail, setDetail] = useState<EstimateDetail | null>(null);
  const [library, setLibrary] = useState<ServiceItem[]>([]);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [d, lib, l] = await Promise.all([loadEstimate(estimateId), loadLibrary(), loadLead(leadId)]);
      setDetail(d);
      setLibrary(lib);
      setCompany(l?.lead.company ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the estimate.");
    } finally {
      setBusy(false);
    }
  }, [estimateId, leadId]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      if (alive) await reload();
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change could not be saved.");
      }
    },
    [reload],
  );

  const t = useMemo(
    () => (detail ? totals(detail.lines, detail.estimate.rate, detail.estimate.vatPercent, detail.estimate.discountPercent) : null),
    [detail],
  );

  if (!isAdmin) return <p className="py-16 text-center text-sm text-muted">Estimates are for Nitsan and Michal only.</p>;
  if (busy) return <p className="py-10 text-sm text-muted">Loading…</p>;
  if (!detail || !t) return <p className="py-10 text-sm text-danger">{error ?? "That estimate no longer exists."}</p>;

  const e = detail.estimate;
  const locked = e.status === "approved";
  const approver = e.approvedBy ? profiles.find((p) => p.id === e.approvedBy) : null;
  const shareUrl = e.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/estimate/${e.shareToken}` : null;
  const activeLib = library.filter((i) => i.active);
  const money = (r: { min: number; max: number }) => fmtNis({ min: r.min * e.rate, max: r.max * e.rate });

  const winners = groupWinners(detail.lines);
  const lineRow = (l: EstimateLine) => {
    const h = t.hours.get(l.id) ?? { min: 0, max: 0 };
    const isWinner = Boolean(l.altGroup) && winners.get(l.altGroup!) === l.id;
    const outOfTotal = l.optional || (l.altGroup && !isWinner);
    const actual = l.taskId ? detail.actual.get(l.taskId) : undefined;
    return (
      <div
        key={l.id}
        className={`group grid grid-cols-[1fr_110px_150px_150px_28px] items-start gap-2 border-t border-border/60 py-2 ${
          outOfTotal ? "opacity-60" : ""
        }`}
      >
        <div className="min-w-0">
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
            <label className="flex items-center gap-1" title="Lines with the same option group are 'choose one'">
              Option group
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
            {actual !== undefined && (
              <span className="text-[#12693d]">Actual: {actual.toFixed(1)} h logged</span>
            )}
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
        {!locked && (
          <button
            onClick={() => void run(() => removeLine(e.id, l.id))}
            aria-label={`Remove ${l.name}`}
            className="pt-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <Link
        href={`/leads/${leadId}`}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} strokeWidth={1.75} /> {company || "Lead"}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif-accent text-[28px] leading-tight">
          Estimate v{e.version} <span className="text-muted">· {company}</span>
        </h1>
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS[e.status].cls}`}>
          {STATUS[e.status].label}
        </span>
        {e.approvedAt && (
          <span className="text-[12px] text-[#12693d]">
            <CheckCircle2 size={12} className="mr-1 inline" />
            Approved{approver ? ` by ${approver.name}` : ""}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SettingsPopupButton which="pricing" label="Settings" onClosed={() => void reload()} />
          <button
            onClick={() => {
              const note = window.prompt("What will change in the new version?", "");
              if (note === null) return;
              void (async () => {
                try {
                  const id = await newVersion(e.id, note, currentUserId);
                  router.push(`/leads/${leadId}/estimates/${id}`);
                } catch (ex) {
                  setError(ex instanceof Error ? ex.message : "Could not copy the estimate.");
                }
              })();
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] hover:border-brand"
          >
            <GitBranchPlus size={14} /> Save as new version
          </button>
          {e.status === "draft" && (
            <button
              onClick={() => void run(() => submitForReview(e.id, currentUserId))}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"
            >
              <Send size={14} /> Send for review
            </button>
          )}
          {e.status === "in_review" && (
            <>
              <button
                onClick={() => void run(() => reopenEstimate(e.id))}
                className="h-8 rounded-lg border border-border bg-surface px-3 text-[12.5px]"
              >
                Back to draft
              </button>
              <button
                onClick={() => void run(() => approveEstimate(e.id, currentUserId))}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"
              >
                <CheckCircle2 size={14} /> Approve
              </button>
            </>
          )}
          {locked && (
            <button
              onClick={() =>
                void run(async () => {
                  await publishEstimate(e.id, company);
                })
              }
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"
            >
              <ExternalLink size={14} /> {e.shareToken ? "Re-publish" : "Publish client link"}
            </button>
          )}
          {e.status === "draft" && (
            <button
              onClick={() => {
                if (!window.confirm(`Delete estimate v${e.version}?`)) return;
                void (async () => {
                  try {
                    await deleteEstimate(e.id);
                    router.push(`/leads/${leadId}`);
                  } catch (ex) {
                    setError(ex instanceof Error ? ex.message : "Could not delete.");
                  }
                })();
              }}
              aria-label="Delete this draft"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-faint hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {e.changeNote && <p className="mt-1 text-[12.5px] text-muted">What changed: {e.changeNote}</p>}
      {shareUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#cde8d6] bg-[#eaf6ee] px-3 py-2 text-[12.5px]">
          <span className="text-[#12693d]">Client link published {e.publishedAt ? new Date(e.publishedAt).toLocaleDateString("en-GB") : ""}:</span>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-brand underline">
            {shareUrl}
          </a>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              } catch {
                window.prompt("Copy this:", shareUrl);
              }
            }}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5"
          >
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {locked && (
        <p className="mt-2 text-[12px] text-faint">
          Approved versions are locked. Use “Save as new version” to make changes.
        </p>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <div className={LABEL}>Intro (client-facing)</div>
            <TextField
              value={e.intro}
              disabled={locked}
              multiline
              rows={5}
              onCommit={(v) => void run(() => updateEstimate(e.id, { intro: v }))}
              className="mt-1 w-full resize-y text-[13px] leading-relaxed"
            />
          </div>

          {detail.phases.map((p) => {
            const lines = detail.lines.filter((l) => l.phaseId === p.id).sort((a, b) => a.position - b.position);
            const sub = t.phase.get(p.id) ?? { min: 0, max: 0 };
            return (
              <div key={p.id} className={CARD}>
                <div className="flex items-center gap-2">
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
                      onClick={() => {
                        if (window.confirm(`Remove ${p.name} and its ${lines.length} lines?`))
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
                <div className="mt-2 grid grid-cols-[1fr_110px_150px_150px_28px] gap-2 text-[11px] uppercase tracking-wide text-faint">
                  <span>Item</span>
                  <span>Category</span>
                  <span className="text-right">Hours</span>
                  <span className="text-right">NIS</span>
                  <span />
                </div>
                {lines.map(lineRow)}
                {!locked && (
                  <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
                    <select
                      value=""
                      onChange={(ev) => {
                        const v = ev.target.value;
                        if (!v) return;
                        const item = v === "blank" ? null : (activeLib.find((i) => i.id === v) ?? null);
                        void run(() => addLine(e.id, p.id, item, lines.length + 1));
                      }}
                      className="rounded-md border border-dashed border-border-strong bg-surface px-2 py-1 text-[12.5px] text-muted"
                      aria-label="Add a line"
                    >
                      <option value="">+ Add a line…</option>
                      {CATEGORIES.map((c) => {
                        const items = activeLib.filter((i) => i.category === c.value);
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
                      <option value="blank">Blank line</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}

          {!locked && (
            <div>
              <button
                onClick={() => void run(() => addPhase(e.id, `Phase ${detail.phases.length + 1}`, detail.phases.length + 1))}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 py-1 text-[12.5px] text-muted hover:border-brand hover:text-brand"
              >
                <Plus size={13} /> Add a phase
              </button>
            </div>
          )}

          <div className={CARD}>
            <div className={LABEL}>Timeline (client-facing)</div>
            <TextField
              value={e.timeline}
              disabled={locked}
              multiline
              rows={4}
              placeholder={locked ? "" : "Phase 1, about 6 weeks: …"}
              onCommit={(v) => void run(() => updateEstimate(e.id, { timeline: v }))}
              className="mt-1 w-full resize-y text-[13px] leading-relaxed"
            />
            <div className={`${LABEL} mt-3`}>Closing</div>
            <TextField
              value={e.closing}
              disabled={locked}
              multiline
              rows={3}
              placeholder={locked ? "" : "We'd be happy to go over this together…"}
              onCommit={(v) => void run(() => updateEstimate(e.id, { closing: v }))}
              className="mt-1 w-full resize-y text-[13px] leading-relaxed"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <div className={CARD}>
            <div className={LABEL}>Totals</div>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px] tabular-nums">
              <dt className="text-muted">Hours</dt>
              <dd className="text-right">{fmtHours(t.totalHours)}</dd>
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-right">{fmtNis(t.subtotal)}</dd>
              {(e.discountPercent ?? 0) > 0 && (
                <>
                  <dt className="text-muted">Discount {e.discountPercent}%</dt>
                  <dd className="text-right text-danger">−{fmtNis(t.discount)}</dd>
                </>
              )}
              <dt className="font-medium">Total + VAT</dt>
              <dd className="text-right font-medium">{fmtNis(t.net)}</dd>
              <dt className="text-faint">VAT {e.vatPercent}%</dt>
              <dd className="text-right text-faint">{fmtNis(t.vat)}</dd>
              <dt className="text-faint">Incl. VAT</dt>
              <dd className="text-right text-faint">{fmtNis(t.gross)}</dd>
            </dl>
          </div>
          <div className={CARD}>
            <div className={LABEL}>Pricing</div>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-y-1.5 text-[13px]">
              <span className="text-muted">Rate (NIS/h)</span>
              <NumField value={e.rate} disabled={locked} onCommit={(v) => void run(() => updateEstimate(e.id, { rate: v ?? 350 }))} className="w-20" />
              <span className="text-muted">VAT %</span>
              <NumField value={e.vatPercent} disabled={locked} onCommit={(v) => void run(() => updateEstimate(e.id, { vatPercent: v ?? 18 }))} className="w-20" />
              <span className="text-muted">Discount %</span>
              <NumField
                value={e.discountPercent}
                disabled={locked}
                onCommit={(v) => void run(() => updateEstimate(e.id, { discountPercent: v && v > 0 ? Math.min(v, 100) : null }))}
                className="w-20"
              />
            </div>
            <TextField
              value={e.discountNote}
              disabled={locked}
              placeholder={locked ? "" : "Why the discount (internal)"}
              onCommit={(v) => void run(() => updateEstimate(e.id, { discountNote: v }))}
              className="mt-1 w-full text-[12px] text-muted"
            />
            <p className="mt-2 text-[11.5px] text-faint">
              No discount by default — only on client request, case by case.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
