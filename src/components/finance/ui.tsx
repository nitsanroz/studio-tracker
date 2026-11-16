"use client";

import type { ReactNode } from "react";
import { Tip } from "@/components/advice-tip";
import { AlertTriangle, ArrowUpRight, Check, CircleAlert } from "lucide-react";
import { STEPS, type Step } from "@/components/finance/cell-state-card";
import { PageSkeleton, SkeletonRows } from "@/components/skeleton";
import { InfoDot, Modal } from "@/components/ui";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    // Phone: the title shares its line with the actions. Wider: title and
    // subtitle left, actions bottom-right.
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:items-end">
      {/* &all: every page's title is `.page-title` (globals.css) */}
      <h1 className="page-title">{title}</h1>
      {actions && (
        <div className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-2 md:row-span-2 md:self-end lg:flex-nowrap [&_button]:whitespace-nowrap">
          {actions}
        </div>
      )}
      {/* Phones are the second screen: no page descriptions there. */}
      {subtitle && <p className="hidden text-sm text-muted md:block">{subtitle}</p>}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    // &all: the tracker's page card — `.app-canvas` drops the outline and
    // rounds it to 20px, the same as every other card in the app.
    <div className={`rounded-2xl border border-border bg-surface p-4 shadow-card md:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  info,
}: {
  children: ReactNode;
  hint?: string;
  /** Shown behind an (i) dot next to the title — what this pane counts,
   * and anything it deliberately leaves out. */
  info?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="flex items-center gap-1.5">
        {/* &all: every card's title is `.card-title` (globals.css) */}
        <h2 className="card-title">{children}</h2>
        {info && <InfoDot>{info}</InfoDot>}
      </span>
      {hint && <span className="shrink-0 text-xs text-faint">{hint}</span>}
    </div>
  );
}

/** &all: a page still loading is the tracker's skeleton, never a "Loading…"
 *  line. `label` is kept for callers and read out to screen readers. */
export function Loading({ label = "Loading", inline = false }: { label?: string; inline?: boolean }) {
  return (
    <div aria-label={label} role="status">
      {inline ? <SkeletonRows rows={4} avatar={false} /> : <PageSkeleton />}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger">
      {message}
    </div>
  );
}

/** Red warning triangle with a hover/focus-revealed explanation card — used
 * wherever a locked figure no longer matches a fresh recomputation, so the
 * drift stays visible instead of silently going stale.
 *
 * A REAL DOM card, deliberately NOT a native `title` attribute: a browser
 * tooltip renders outside the page's stylable tree, so Discreet mode's
 * privacy blur (which targets `.tabular-nums` inside `main`) could never
 * reach it — the exact locked/fresh/diff ₪ figures stayed legible even with
 * every other number on screen blurred. Callers pass `children` built with
 * `formatILS` and wrap each amount in its own `.tabular-nums` span so those
 * figures blur individually, same as everywhere else money is shown. */
/** &all (2026-11-16): the app's one hover box (`Tip`), so it flips and stays on
 *  screen like every other — the box is portalled, outside any table's overflow. */
export function MismatchTriangle({ children }: { children: ReactNode }) {
  return (
    <Tip as="button" label="Mismatch details" body={children} className="text-danger">
      <AlertTriangle size={12} />
    </Tip>
  );
}

/** &all: finance's (i) is the app's one info dot (components/ui.tsx → InfoTip). */
export { InfoDot };

/** Draft/predicted/final color-key, shared by every grid that colors cells
 * by `cellStateClass` (Plan, Salaries, Freelance, Rent) — so a user who only
 * ever sees one of these grids (e.g. an expenses-only admin confined to
 * Rent) still has somewhere on the page to learn what the colors mean.
 * Every state counts in every real total — this is a workflow signal
 * (how settled a figure is), not a filter on what gets summed. `steps`:
 * cells move Draft → Predicted → Final → Paid from the card above a
 * selected cell (cell-state-card.tsx), not hover icons. */
export function StateLegend({ hint, steps, invoiced }: { hint?: ReactNode; steps?: boolean; invoiced?: boolean }) {
  // Colour and name only (Nitsan, 2026-11-02: "too textual") — what each one
  // means is the item's hover, and how to move a cell is the ⓘ at the end.
  const text = (s: Step) => STEPS.find((x) => x.step === s)!;
  const item = (swatch: ReactNode, label: string, hint: string) => (
    <span className="flex cursor-help items-center gap-1.5" title={hint}>
      {swatch}
      {label}
    </span>
  );
  const step = (swatch: ReactNode, s: Step, alt?: string) => item(swatch, text(s).label, alt ?? text(s).hint);
  const items = (
    <>
      {step(<span className="h-3 w-3 shrink-0 rounded-sm border border-border bg-surface" />, "actual")}
      {step(<span className="h-3 w-3 shrink-0 rounded-sm border border-[var(--state-predicted-border)] bg-[var(--state-predicted-bg)]" />, "predicted")}
      {step(
        <span className="h-3 w-3 shrink-0 rounded-sm border border-[var(--state-final-border)] bg-[var(--state-final-bg)]" />,
        "final",
        steps ? undefined : "Checked and locked — click a cell to lock/unlock it",
      )}
      {steps &&
        invoiced &&
        item(
          <span
            aria-hidden
            className="flex h-3.5 shrink-0 items-center rounded-sm bg-[var(--state-final-bg)] px-0.5 outline-dashed outline-[1.5px] -outline-offset-1 outline-[var(--state-uninvoiced)]"
          >
            <NeedsInvoiceMark />
          </span>,
          "No invoice yet",
          "Final, but the invoice hasn't gone out — send it, then move the cell to Invoiced",
        )}
      {steps &&
        invoiced &&
        step(
          <span aria-hidden className="flex h-3.5 shrink-0 items-center rounded-sm border border-[var(--state-invoiced-border)] bg-[var(--state-invoiced-bg)] px-0.5 text-[var(--state-invoiced-fg)]">
            <InvoicedMark />
          </span>,
          "invoiced",
          "The invoice is out — waiting for the money",
        )}
      {steps &&
        step(
          <span aria-hidden className="flex h-3.5 shrink-0 items-center rounded-sm border border-[var(--state-paid-border)] bg-[var(--state-paid-bg)] px-0.5 text-[var(--state-paid-fg)]">
            <PaidMark />
          </span>,
          "paid",
        )}
      {steps && (
        <InfoDot>Select a cell to move it: Draft → Predicted → Final → {invoiced ? "Invoiced → " : ""}Paid. Hover a colour for what it means.</InfoDot>
      )}
    </>
  );
  return (
    <>
      <div className="mb-3 hidden flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted md:flex">
        {items}
        {hint && <span className="ml-auto flex items-center gap-1.5 text-faint">{hint}</span>}
      </div>
      {/* Phone: the same key, folded — the colours mean the same at any width. */}
      <details className="mb-3 text-xs text-muted md:hidden">
        <summary className="cursor-pointer select-none text-faint">What the colours mean</summary>
        <div className="mt-2 flex flex-col gap-1.5">{items}</div>
      </details>
    </>
  );
}

/** Invoiced (the Plan's income cells, reference/0013): a small ↗ — the invoice went out — read out as "Invoiced". */
export function InvoicedMark() {
  return (
    <>
      <ArrowUpRight aria-hidden className="mr-0.5 inline-block h-3.5 w-3.5 -translate-y-px align-middle" strokeWidth={3} />
      <span className="sr-only">Invoiced: </span>
    </>
  );
}

/** Final but no invoice yet (the Plan's income cells): an alert before the
 * amount, in the missing-invoice red — the cell isn't done until it's invoiced. */
export function NeedsInvoiceMark() {
  return (
    <>
      <CircleAlert aria-hidden className="mr-0.5 inline-block h-3.5 w-3.5 -translate-y-px align-middle text-[var(--state-uninvoiced)]" strokeWidth={2.5} />
      <span className="sr-only">Not invoiced yet: </span>
    </>
  );
}

/**
 * Paid, beyond colour (UX review 2026-10-31): the dark green amount alone was
 * one shade from final's, so a paid amount also carries a small tick, read
 * out as "Paid" to a screen reader.
 */
export function PaidMark() {
  return (
    <>
      <Check aria-hidden className="mr-0.5 inline-block h-3 w-3 -translate-y-px align-middle" strokeWidth={3} />
      <span className="sr-only">Paid: </span>
    </>
  );
}

/** Centered modal confirmation — for any destructive-ish action (delete,
 * category move) that's easy to fat-finger on a hover-only icon and
 * warrants a real popup instead of an inline affordance.
 * &all (2026-11-16): drawn in the tracker's own dialog (`Modal`, the same box
 * and buttons as `askConfirm`), and like it, a DANGEROUS one focuses Cancel so
 * an Enter pressed out of habit can't delete anything. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} width="md" align="center" layer="raised" labelledBy="finance-confirm-title">
      <p id="finance-confirm-title" className="bidi-auto text-sm font-medium">
        {title}
      </p>
      <p className="bidi-auto mt-1 whitespace-pre-line text-[13px] leading-relaxed text-muted">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button autoFocus={danger} onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-xs">
          Cancel
        </button>
        <button
          autoFocus={!danger}
          onClick={onConfirm}
          className={`h-8 rounded-lg px-3 text-xs font-medium text-white ${danger ? "bg-danger" : "bg-brand"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
