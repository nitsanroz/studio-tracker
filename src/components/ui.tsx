"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Info, X } from "lucide-react";
import { useDataMaybe } from "@/lib/store";
import { formatHoursDecimal } from "@/lib/format";
import type { Client, Profile } from "@/lib/types";
import { ClientAvatar } from "./client-avatar";

export interface ContextMenuItem {
  label: string;
  hint?: string; // e.g. "⌘C"
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** Right-click menu at a fixed position; any outside click closes it. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  // keep the menu inside the viewport
  const width = 190;
  const height = items.length * 34 + 10;
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - width - 8);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 9999) - height - 8);
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 flex flex-col rounded-lg border border-border bg-surface p-1 shadow-xl"
        style={{ left, top, minWidth: width }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm disabled:opacity-40 ${
              item.danger ? "text-danger hover:bg-red-50" : "hover:bg-background"
            }`}
          >
            {item.label}
            {item.hint && <span className="text-xs text-faint">{item.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

export type TabItem<T extends string> =
  | T
  | {
      value: T;
      label: React.ReactNode;
      count?: number;
      title?: string;
      disabled?: boolean;
      /**
       * Rendered as a SIBLING of the tab button, on the same line. For a control
       * that belongs to one tab — the Timeline's (i) — which can't go inside the
       * label, because a button cannot contain a button.
       */
      after?: React.ReactNode;
    };

/**
 * The tab strip — and ONLY the strip. It deliberately doesn't own the panels:
 * the member page needs its HR panel kept mounted while hidden (its inputs are
 * uncontrolled, so unmounting would discard typed text), which a component that
 * renders `children` for the active tab can't offer.
 *
 * Two skins: `underline` for a real tab bar, `segmented` for the pill group that
 * was copy-pasted into the client view and the time feed.
 *
 * Not used by the client-report tab strip, which carries colour dots, a per-tab
 * hide button and overflow arrows — folding that in would bloat this API.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  variant = "underline",
  size = "md",
  className = "",
  ariaLabel,
  right,
}: {
  value: T;
  onChange: (v: T) => void;
  items: readonly TabItem<T>[];
  variant?: "underline" | "segmented";
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  /** trailing content inside the strip's row (underline variant only) */
  right?: React.ReactNode;
}) {
  // a bare string item renders capitalised, which is what makes
  // `items={["list","board"] as const}` a drop-in for the old segmented controls
  const norm = items.map((it) =>
    typeof it === "string"
      ? {
          value: it,
          label: it as React.ReactNode,
          bare: true,
          count: undefined,
          title: undefined,
          disabled: false,
          after: undefined,
        }
      : { ...it, bare: false },
  );
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const enabled = norm.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.value === value);
    if (i < 0) return;
    e.preventDefault();
    const next = enabled[(i + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
    onChange(next.value);
  }

  const buttons = norm.map((t) => {
    const active = t.value === value;
    const cls =
      variant === "segmented"
        ? `rounded-md font-medium transition-colors disabled:opacity-40 ${pad} ${
            active ? "bg-brand-soft text-brand-dark" : "text-muted hover:text-foreground"
          }`
        : `-mb-px shrink-0 border-b-2 font-medium transition-colors disabled:opacity-40 ${
            size === "sm" ? "px-1.5 pb-1.5 text-xs" : "px-1 pb-2 text-sm"
          } ${
            active
              ? "border-brand text-brand-dark"
              : "border-transparent text-muted hover:text-foreground"
          }`;
    const button = (
      <button
        key={t.value}
        type="button"
        role="tab"
        aria-selected={active}
        disabled={t.disabled}
        title={t.title}
        onClick={() => onChange(t.value)}
        className={t.bare ? `capitalize ${cls}` : cls}
      >
        {t.label}
        {t.count != null && <span className="ml-1.5 text-xs tabular-nums text-faint">{t.count}</span>}
      </button>
    );
    if (!t.after) return button;
    // The nudge matches the button's own bottom padding, so the adornment sits
    // on the label's line rather than on the centre of the taller tab box.
    return (
      <span key={t.value} className="flex items-center gap-1">
        {button}
        <span className={variant === "underline" ? (size === "sm" ? "mb-1.5" : "mb-2") : ""}>
          {t.after}
        </span>
      </span>
    );
  });

  if (variant === "segmented") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={`flex rounded-lg border border-border bg-surface p-0.5 ${className}`}
      >
        {buttons}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // ⚠️ `overflow-x-auto` + `shrink-0` on the labels. This strip had neither
      // wrap nor scroll, so at 375px Settings' five tabs simply ran off the
      // right-hand edge with no way to reach the last two. Scrolling is the
      // right degradation for tabs — wrapping them onto a second line moves the
      // underline away from the content it belongs to. `whitespace-nowrap` keeps
      // a two-word label ("Studio setup") on one line inside the scroller.
      // `[scrollbar-width:none]` because a permanent scrollbar under a tab strip
      // reads as a divider. This reaches all 8 Tabs call sites at once.
      className={`flex items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-border [scrollbar-width:none] ${className}`}
    >
      {buttons}
      {right && <span className="ml-auto shrink-0 pb-1">{right}</span>}
    </div>
  );
}

const MODAL_WIDTH = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  // Wide enough for a multi-column figure grid. Anything reading as a POSTER
  // rather than a form wants these; a text modal should never go past 2xl.
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
} as const;

/**
 * The overlay + centred card every popup in the app hand-rolled. Adds two things
 * none of them had: Escape closes, and focus moves into the card on open.
 *
 * `layer="raised"` is for a popup opened from INSIDE the task drawer, which is
 * itself overlay-40 / panel-50 — at equal z-index the drawer wins on DOM order
 * and the popup would be visible but dead.
 */
export function Modal({
  onClose,
  children,
  width = "md",
  align = "third",
  layer = "base",
  labelledBy,
  className = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  width?: keyof typeof MODAL_WIDTH;
  align?: "third" | "center";
  layer?: "base" | "raised";
  labelledBy?: string;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // preventScroll, because a card taller than the viewport makes the browser
    // scroll to reveal it — and on a COLD open (web fonts still loading) the
    // content is briefly taller than it ends up, so a modal with its own
    // scroller opened part-way down and stayed there. The card is fixed and
    // centred, so there is never anything to scroll to.
    card.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [overlayZ, cardZ] = layer === "raised" ? ["z-[60]", "z-[70]"] : ["z-40", "z-50"];
  return (
    <>
      <div className={`fixed inset-0 ${overlayZ} bg-black/20`} onClick={onClose} />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`fixed left-1/2 ${align === "center" ? "top-1/2" : "top-1/3"} ${cardZ} w-full ${
          MODAL_WIDTH[width]
        } -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl focus:outline-none ${className}`}
      >
        {children}
      </div>
    </>
  );
}

/** The ✕ every modal puts in its header. */
export function ModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      title="Close"
      className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-foreground"
    >
      <X size={16} />
    </button>
  );
}

/**
 * A task title that opens the task pane. `beforeOpen` lets a popup close itself
 * first — the pane is mounted last in the shell, so at equal z-index it paints
 * over a popup card while the popup's own dimmer still sits above the pane.
 */
export function TaskNameLink({
  title,
  taskId,
  beforeOpen,
  className = "",
}: {
  title: string;
  taskId: string;
  beforeOpen?: () => void;
  className?: string;
}) {
  const store = useDataMaybe();
  if (!store) return <span className={`bidi-auto truncate ${className}`}>{title}</span>;
  return (
    <button
      type="button"
      title="Open task"
      onClick={(e) => {
        e.stopPropagation();
        beforeOpen?.();
        store.openTask(taskId);
      }}
      className={`bidi-auto max-w-full truncate text-left underline-offset-2 hover:text-brand hover:underline ${className}`}
    >
      {title}
    </button>
  );
}

/**
 * Collapse/expand chevron with an enlarged hit area.
 * Pass `onClick` when the chevron is the toggle itself; omit it when a
 * clickable parent handles toggling (renders decorative, no double target).
 */
export function CollapseChevron({
  open,
  onClick,
  size = 14,
}: {
  open: boolean;
  onClick?: (e: MouseEvent) => void;
  size?: number;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  if (!onClick) {
    return <Icon size={size} className="pointer-events-none shrink-0 text-muted" />;
  }
  return (
    <button
      onClick={onClick}
      className="relative -m-1.5 shrink-0 rounded p-1.5 text-muted before:absolute before:-inset-1 hover:bg-black/5 hover:text-foreground"
      title={open ? "Collapse" : "Expand"}
    >
      <Icon size={size} />
    </button>
  );
}

/**
 * Small circled "i" that reveals an explanation on hover/focus. A real popover
 * rather than a `title` attribute: these carry two or three lines about how a
 * figure is calculated, which the native tooltip renders as one unreadable run
 * and only after a delay.
 */
export function InfoDot({
  title,
  children,
  align = "left",
  side = "down",
}: {
  title?: string;
  children: React.ReactNode;
  /** which edge of the dot the card hangs from — flip to "right" near a pane edge */
  align?: "left" | "right";
  /**
   * which way it opens. Flip to "up" on the last row of anything that sits in a
   * scroller or near the bottom of a panel — a card opening downward there is
   * clipped, and an explanation you can't finish reading is worse than none.
   */
  side?: "down" | "up";
}) {
  return (
    <span className="group/info relative inline-flex align-middle">
      <button
        type="button"
        aria-label={title ? `About ${title}` : "About this figure"}
        // ⚠️ The glyph is DRAWN, not typeset. This was a bordered circle with a
        // 9px "i" inside it, and `leading-none` makes the line box shorter than
        // the font's own content box — so the ascent overflowed upward and the
        // letter sat 1px high, touching the ring. Any pixel nudge that fixed it
        // would be a fact about Rubik, and this app falls back to Rubik only
        // until the real Saans lands (see the Brand section of CLAUDE.md) — at
        // which point the nudge would be wrong again. An icon centres by
        // geometry and cannot drift with the font.
        //
        // opacity-80, not 60: the dot usually inherits `text-muted`, and at 60%
        // that composites to roughly 2.5:1 on white — under the 3:1 floor for a
        // control, on a 14px target. It still reads as secondary.
        className="flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none"
      >
        <Info size={14} strokeWidth={2.25} aria-hidden />
      </button>
      <span
        role="tooltip"
        // ⚠️ `whitespace-normal` is load-bearing, not tidiness. A dot placed
        // inside anything `whitespace-nowrap` (the About panel's donut legend)
        // inherits it, and the card keeps its 240px box while the sentence
        // runs out of the side as ONE line — measured at 1,277px of spill.
        // The same reasoning as the `normal-case`/`tracking-normal`/
        // `leading-relaxed` beside it: this card is prose, so it has to
        // re-state every text property its host might have set for a label.
        className={`pointer-events-none absolute z-30 hidden w-60 whitespace-normal rounded-xl border border-border bg-surface p-2.5 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-foreground shadow-xl group-focus-within/info:block group-hover/info:block ${
          align === "right" ? "right-0" : "left-0"
        } ${side === "up" ? "bottom-5" : "top-5"}`}
      >
        {title && <span className="mb-1 block font-semibold">{title}</span>}
        <span className="block text-muted">{children}</span>
      </span>
    </span>
  );
}

const AVATAR_COLORS = [
  "#0b43ed",
  "#7c5cff",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#e879a0",
  "#06b6d4",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function hashColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

export function Avatar({
  profile,
  size = 28,
  emptyTitle = "Unassigned",
}: {
  profile: Profile | null;
  size?: number;
  /**
   * Tooltip for the no-profile placeholder. Needed because this span's own
   * `title` beats any wrapper's on hover: a caller that knew who the person was
   * (a recovered entry naming its author, say) had its label silently replaced
   * by the word "Unassigned", which said the opposite of the truth.
   */
  emptyTitle?: string;
}) {
  if (!profile) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-border-strong text-faint shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        title={emptyTitle}
      >
        ?
      </span>
    );
  }
  if (profile.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt={profile.name}
        title={profile.name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size, opacity: profile.active ? 1 : 0.45 }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundColor: hashColor(profile.name),
        opacity: profile.active ? 1 : 0.45,
      }}
      title={profile.name}
    >
      {initials(profile.name)}
    </span>
  );
}

export function ClientChip({
  client,
  size = "md",
  link = true,
}: {
  client: Client;
  size?: "sm" | "md";
  /** set false where the chip sits inside another link/button */
  link?: boolean;
}) {
  const inner = (
    <>
      <ClientAvatar client={client} size={size === "sm" ? 16 : 18} radius="full" />
      {client.name}
    </>
  );
  // The mark and the name read as one object, so they sit in a white capsule
  // together. bg-surface (not white) so it still separates from a background-toned
  // row, and the border is what makes it visible on a surface-toned one.
  //
  // The mark sits FLUSH to the left edge (`pl-0.5`) rather than inset like the
  // old colour dot: that is what keeps the capsule at its previous height —
  // 22px at sm, 26px at md — so no feed row, table row or header grows when a
  // client gains an icon.
  const cls = `inline-flex items-center rounded-full border border-border bg-surface font-medium ${
    size === "sm" ? "gap-1 py-0.5 pl-0.5 pr-2 text-xs" : "gap-1.5 py-0.5 pl-0.5 pr-2.5 text-sm"
  }`;
  if (!link) return <span className={cls}>{inner}</span>;
  return (
    <Link
      href={`/clients/${client.id}`}
      onClick={(e) => e.stopPropagation()}
      // the capsule already reads as a target, so the hover is a border tint
      // rather than an underline running under the mark
      className={`${cls} hover:border-brand hover:text-brand`}
      title={`Open ${client.name}`}
    >
      {inner}
    </Link>
  );
}

const LEGACY_TAG_STYLES: Record<string, string> = {
  "in design": "bg-brand-soft text-brand-dark",
  "waiting for client approval": "bg-amber-100 text-amber-800",
  "in development": "bg-purple-100 text-purple-800",
  "done and approved": "bg-emerald-100 text-emerald-800",
};

const DEFAULT_TAG_COLOR = "#6b7280";

export function TagBadge({ tag }: { tag: string }) {
  const store = useDataMaybe();
  const color = store?.tags.find((t) => t.name === tag)?.color;
  // custom DB color → tinted badge; otherwise legacy name-based styles
  if (color && color !== DEFAULT_TAG_COLOR) {
    return (
      <span
        className="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {tag}
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${LEGACY_TAG_STYLES[tag] ?? "bg-gray-100 text-gray-700"}`}
    >
      {tag}
    </span>
  );
}

export function BudgetBar({
  doneMinutes,
  estimateHours,
  label = "both",
}: {
  doneMinutes: number;
  estimateHours: number | null;
  /**
   * What text rides beside the bar. `doneMinutes` is always required — it drives
   * the fill and the over-budget colour whichever label you pick.
   * `both` = "12/24h" (the original) · `budget` = "24h", for a table that has a
   * separate Hours column · `none` = bar only, where the numbers are already
   * spelled out above it.
   */
  label?: "both" | "budget" | "none";
}) {
  // No budget set: still show the hours logged. This used to render nothing at all,
  // which meant a task without an estimate showed no hours anywhere on the client
  // table — the logged time was invisible unless someone opened the task.
  if (estimateHours == null) {
    if (label === "none") return null;
    if (label === "budget") return <span className="text-xs text-faint">–</span>;
    return (
      <span className={`text-xs whitespace-nowrap ${doneMinutes > 0 ? "text-muted" : "text-faint"}`}>
        {doneMinutes > 0 ? `${formatHoursDecimal(doneMinutes)}h` : "–"}
      </span>
    );
  }
  const doneH = doneMinutes / 60;
  const pct = Math.min(100, (doneH / estimateHours) * 100);
  const over = doneH > estimateHours;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 w-16 rounded-full bg-border overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${over ? "bg-danger" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {label !== "none" && (
        <span
          className={`text-xs whitespace-nowrap ${over ? "text-danger font-semibold" : "text-muted"}`}
        >
          {label === "both" && `${formatHoursDecimal(doneMinutes)}/`}
          {estimateHours}h
        </span>
      )}
    </div>
  );
}
