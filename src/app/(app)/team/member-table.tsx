"use client";

// The team as a dense table, as an alternative to the portrait cards. The cards
// are for recognising people; this is for comparing them — who logged what, who
// is carrying how many open tasks, who started and who left.
//
// Every figure comes from the page's own memos, passed in as `rows`, so the two
// layouts cannot disagree about a number.

import Link from "next/link";
import { Avatar } from "@/components/ui";
import { PercentRing } from "@/components/charts";
import { useColWidths, ResizeHandle } from "@/components/resizable";
import { formatHoursShort } from "@/lib/format";
import type { Profile } from "@/lib/types";

export interface MemberRow {
  profile: Profile;
  minutes: number;
  billablePct: number | null;
  /** the share written down to a client's Keys task — drawn red inside the ring */
  keysPct: number;
  /** the three-way split as a hover line, built by `splitTitle` */
  splitTitle: string;
  openTasks: number;
  email?: string;
  tenure: string | null;
}

const DEFAULTS: Record<string, number> = {
  role: 84,
  email: 190,
  started: 92,
  tenure: 72,
  hours: 88,
  open: 64,
  billable: 96,
};

export function MemberTable({ rows, periodLabel }: { rows: MemberRow[]; periodLabel: string }) {
  const { widths, startResize } = useColWidths("team-members", DEFAULTS);
  const cell = (key: string) => ({ width: widths[key] ?? DEFAULTS[key], flexShrink: 0 }) as const;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <div className="min-w-fit">
        {/* group/thead is what makes the resize handles appear on hover */}
        <div className="group/thead flex items-center gap-3 border-b border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="min-w-40 flex-1">Member</span>
          <span className="relative" style={cell("role")}>
            Role
            <ResizeHandle onMouseDown={startResize("role")} />
          </span>
          <span className="relative" style={cell("email")}>
            Email
            <ResizeHandle onMouseDown={startResize("email")} />
          </span>
          <span className="relative" style={cell("started")}>
            Started
            <ResizeHandle onMouseDown={startResize("started")} />
          </span>
          <span className="relative" style={cell("tenure")}>
            Tenure
            <ResizeHandle onMouseDown={startResize("tenure")} />
          </span>
          <span className="relative" style={cell("started")} title="Last day, when set">
            Left
          </span>
          <span
            className="relative"
            style={cell("hours")}
            title={`Hours logged in ${periodLabel.toLowerCase()}`}
          >
            Hours · {periodLabel.toLowerCase()}
            <ResizeHandle onMouseDown={startResize("hours")} />
          </span>
          <span className="relative" style={cell("open")} title="Open tasks assigned">
            Open
            <ResizeHandle onMouseDown={startResize("open")} />
          </span>
          <span className="relative" style={cell("billable")}>
            Billable
          </span>
        </div>

        {rows.map(({ profile: p, minutes, billablePct, keysPct, splitTitle, openTasks, email, tenure }) => (
          // the whole row is the link, so nothing inside may be a link of its own
          <Link
            key={p.id}
            href={`/team/${p.id}`}
            className={`flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-background ${
              p.active ? "" : "opacity-60"
            }`}
          >
            <span className="flex min-w-40 flex-1 items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${p.active ? "bg-success" : "bg-border-strong"}`}
                title={p.active ? "Active" : "Archived"}
              />
              {/* Avatar, not MemberPhoto: the bleeding 124px cut-out is a card
                  device and can't sit in a 40px row */}
              <Avatar profile={p} size={28} />
              <span className="truncate font-medium">{p.name}</span>
            </span>
            <span className="truncate capitalize text-muted" style={cell("role")}>
              {p.role}
            </span>
            <span className="truncate text-xs text-muted" style={cell("email")} title={email}>
              {email ?? "–"}
            </span>
            <span className="text-xs tabular-nums text-muted" style={cell("started")}>
              {p.startDate ?? "–"}
            </span>
            <span className="text-xs text-muted" style={cell("tenure")}>
              {tenure ?? "–"}
            </span>
            <span className="text-xs tabular-nums text-muted" style={cell("started")}>
              {p.endDate ?? "–"}
            </span>
            <span className="tabular-nums" style={cell("hours")}>
              {minutes > 0 ? formatHoursShort(minutes) : <span className="text-faint">–</span>}
            </span>
            <span className="tabular-nums text-muted" style={cell("open")}>
              {openTasks || <span className="text-faint">–</span>}
            </span>
            {/* ⚠️ The number is still the BILLABLE share and nothing else — the
                red arc describes the remainder, and the tooltip carries the
                three-way split. */}
            <span className="flex items-center gap-1.5" style={cell("billable")} title={splitTitle}>
              {billablePct == null ? (
                <span className="text-faint">–</span>
              ) : (
                <>
                  <PercentRing pct={billablePct} keys={keysPct} size={24} label={splitTitle} />
                  <span className="text-xs tabular-nums text-muted">{billablePct}%</span>
                </>
              )}
            </span>
          </Link>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-faint">No members to show.</div>
        )}
      </div>
    </div>
  );
}
