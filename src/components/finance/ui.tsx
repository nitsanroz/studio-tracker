"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowUpRight, Check, CircleAlert, Info } from "lucide-react";
import { STEPS, type Step } from "@/components/finance/cell-state-card";
import { PageSkeleton, SkeletonRows } from "@/components/skeleton";

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
/** `align="right"` keeps the card from running off the right edge of a
 * scrollable table — same purpose as InfoDot's `align`, see below. */
export function MismatchTriangle({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  // Rendered in a table's sticky/scrolling header, a CSS-positioned tooltip
  // gets clipped by that header's own overflow (and can even feed back into
  // its auto-sizing, visibly shifting the trigger under the cursor on open).
  // A portal escapes all of that — it's placed at the trigger's actual
  // screen coordinates, outside any ancestor's layout or overflow entirely.
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const show = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
  const hide = () => setRect(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label="Mismatch details"
        className="cursor-help text-danger"
      >
        <AlertTriangle size={12} />
      </button>
      {rect &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: rect.bottom + 6,
              ...(align === "right"
                ? { right: window.innerWidth - rect.right }
                : { left: rect.left }),
            }}
            className="z-50 w-72 rounded-lg border border-border bg-surface p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-muted shadow-card"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Small circled-"i" affordance that reveals an explanation card on
 * hover/focus — for a pane whose numbers need a sentence nobody has room to
 * print underneath it. `align="right"` keeps the card from running off the
 * right edge of a narrow pane. */
export function InfoDot({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Fixed to the viewport, not the dot's box: a dot inside a scrolling table
  // (overflow-x-auto clips both ways) would otherwise cut its card off. Kept
  // on screen, and flipped above the dot when there's no room below.
  useLayoutEffect(() => {
    if (!open || !button.current || !tip.current) return;
    const b = button.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = b.bottom + gap;
    const top = below + t.height > window.innerHeight - margin && b.top - gap - t.height > margin ? b.top - gap - t.height : below;
    const wanted = align === "right" ? b.right - t.width : b.left;
    const left = Math.min(Math.max(margin, wanted), window.innerWidth - t.width - margin);
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          setOpen(false);
          setPos(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPos(null);
        }}
        aria-label="More info"
        className="flex h-4 w-4 items-center justify-center rounded-full text-faint hover:text-muted"
      >
        <Info size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-muted shadow-card"
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}

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
 * warrants a real popup instead of an inline affordance. */
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${danger ? "bg-danger hover:bg-danger/90" : "bg-brand hover:bg-brand-dark"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
