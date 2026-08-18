"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Inbox, PencilLine } from "lucide-react";

/**
 * Admin notification queue in the header. One place for things that are
 * waiting on a decision — currently client intake requests. The badge is the
 * total; nothing clears itself.
 */

interface Item {
  count: number;
  href: string;
  label: string;
  detail: string;
  Icon: typeof Inbox;
  tone: "brand" | "danger";
}

/**
 * ⚠️ `updatedIntake` is counted SEPARATELY from `pendingIntake`, not folded into
 * it, and the reason is the case Nitsan raised: a client can revise a brief that
 * is ALREADY A TASK he has rewritten. Such a brief is not pending, so the
 * pending count cannot see it — and it is the one that most needs saying out
 * loud, because nothing else on screen would mention it.
 */
export function NotificationsBell({
  pendingIntake,
  updatedIntake = 0,
}: {
  pendingIntake: number;
  updatedIntake?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Item[] = ([
    {
      count: pendingIntake,
      href: "/intake-queue",
      label: `${pendingIntake} client ${pendingIntake === 1 ? "request" : "requests"} to review`,
      detail: "Submitted through an intake form",
      Icon: Inbox,
      tone: "brand",
    },
    {
      count: updatedIntake,
      href: "/intake-queue",
      label: `${updatedIntake} brief${updatedIntake === 1 ? "" : "s"} changed by the client`,
      // Says the load-bearing part: a revision never rewrote the task, so
      // whatever the studio has drawn or written is still there.
      detail: "Read what changed — the task is untouched",
      Icon: PencilLine,
      tone: "brand",
    },
  ] satisfies Item[]).filter((i) => i.count > 0);

  const total = pendingIntake + updatedIntake;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={total > 0 ? `Notifications — ${total} waiting` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="menu"
        title={total > 0 ? `${total} waiting on you` : "Nothing waiting"}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Bell size={17} strokeWidth={1.75} />
        {total > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-[17px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-faint">
            Waiting on you
          </div>
          {items.length === 0 ? (
            <div className="flex items-center gap-2.5 px-4 py-5 text-sm text-muted">
              <Check size={16} strokeWidth={1.75} className="text-success" />
              You&apos;re all caught up.
            </div>
          ) : (
            items.map(({ count, href, label, detail, Icon, tone }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-background"
              >
                <Icon
                  size={17}
                  strokeWidth={1.75}
                  className={`mt-0.5 shrink-0 ${tone === "danger" ? "text-danger" : "text-brand"}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{detail}</span>
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-danger px-1.5 text-[10px] font-bold leading-[17px] text-white">
                  {count}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
