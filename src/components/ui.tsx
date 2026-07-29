"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDataMaybe } from "@/lib/store";
import { formatHoursDecimal } from "@/lib/format";
import type { Client, Profile } from "@/lib/types";

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
}: {
  title?: string;
  children: React.ReactNode;
  /** which edge of the dot the card hangs from — flip to "right" near a pane edge */
  align?: "left" | "right";
}) {
  return (
    <span className="group/info relative inline-flex align-middle">
      <button
        type="button"
        aria-label={title ? `About ${title}` : "About this figure"}
        className="flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none opacity-60 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-5 z-30 hidden w-60 rounded-xl border border-border bg-surface p-2.5 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-foreground shadow-xl group-focus-within/info:block group-hover/info:block ${
          align === "right" ? "right-0" : "left-0"
        }`}
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

export function Avatar({ profile, size = 28 }: { profile: Profile | null; size?: number }) {
  if (!profile) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-border-strong text-faint shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        title="Unassigned"
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
      <span
        className="rounded-full shrink-0"
        style={{
          width: size === "sm" ? 8 : 10,
          height: size === "sm" ? 8 : 10,
          backgroundColor: client.color,
        }}
      />
      {client.name}
    </>
  );
  // The dot and the name read as one object, so they sit in a white capsule
  // together. bg-surface (not white) so it still separates from a background-toned
  // row, and the border is what makes it visible on a surface-toned one.
  const cls = `inline-flex items-center gap-1.5 rounded-full border border-border bg-surface font-medium ${
    size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-sm"
  }`;
  if (!link) return <span className={cls}>{inner}</span>;
  return (
    <Link
      href={`/clients/${client.id}`}
      onClick={(e) => e.stopPropagation()}
      // the capsule already reads as a target, so the hover is a border tint
      // rather than an underline running under the dot
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
}: {
  doneMinutes: number;
  estimateHours: number | null;
}) {
  // No budget set: still show the hours logged. This used to render nothing at all,
  // which meant a task without an estimate showed no hours anywhere on the client
  // table — the logged time was invisible unless someone opened the task.
  if (estimateHours == null) {
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
      <span className={`text-xs whitespace-nowrap ${over ? "text-danger font-semibold" : "text-muted"}`}>
        {formatHoursDecimal(doneMinutes)}/{estimateHours}h
      </span>
    </div>
  );
}
