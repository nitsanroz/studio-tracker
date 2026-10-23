import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { StudioArrow } from "./studio-arrow";

/**
 * "Icon + action" (motion round 2, 2026-10-23): an empty list says what it is
 * with an icon on a soft tile and one plain line, and — where there is an
 * obvious next move — offers it, instead of a grey sentence on its own.
 *
 * `compact` is for an empty list inside a card on Home; the default is for a
 * page's main list. Keep the line short: it replaces the content, it is not a
 * paragraph about it.
 */
export function EmptyState({
  icon: Icon,
  text,
  action,
  compact = false,
  tone = "brand",
  className = "",
}: {
  icon: LucideIcon;
  text: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  compact?: boolean;
  /** "success" for an empty that is good news — nothing waiting, all handled */
  tone?: "brand" | "success";
  className?: string;
}) {
  const tile = tone === "success" ? "bg-success/10 text-success" : "bg-brand-soft text-brand";
  const actionCls = "inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline";
  return (
    <div className={`flex flex-col items-center gap-2.5 text-center ${compact ? "px-4 py-6" : "px-4 py-12"} ${className}`}>
      <span className={`flex items-center justify-center rounded-xl ${tile} ${compact ? "size-9" : "size-11"}`}>
        <Icon size={compact ? 18 : 20} strokeWidth={1.75} />
      </span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
      {action &&
        ("href" in action ? (
          <Link href={action.href} className={actionCls}>
            {action.label} <StudioArrow size={15} />
          </Link>
        ) : (
          <button onClick={action.onClick} className={actionCls}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
