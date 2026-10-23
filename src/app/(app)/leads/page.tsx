"use client";

// The pipeline board — every lead from first reply to won or lost.
//
// ⚠️ ADMIN-ONLY, AND THE GATE IS THE DATABASE (0042: `admin all`, nothing
// else). The check below only explains a blank page to anybody else.
//
// ⚠️ BUILT ON THE CANDIDATES BOARD (`candidates/page.tsx`) — same drag-ref,
// same optimistic drop with rollback, same board/list toggle stored per
// browser. Two differences: Won and Lost are COLUMNS here (narrow, folded
// until opened), because a won deal is the point of the board rather than an
// archive; and dropping on either opens a question instead of moving the card.
//
// ⚠️ LAYOUT (v1.71.0): the page uses the whole screen. Board and List are VIEW
// MODES of the main column — two arrangements of the same leads. Today and
// Summary are not views of the leads, they are about the pipeline as a whole,
// so they live in a pane on the right, as its two tabs, beside whichever view
// is showing. The pane folds away (stored per browser) when the board wants
// the room.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { liftDrag } from "@/lib/drag-lift";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  ArrowRight,
  Calculator,
  CalendarCheck,
  CalendarClock,
  ChartPie,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Lightbulb,
  List,
  MailWarning,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  SearchX,
  Send,
  SlidersHorizontal,
  SquareKanban,
  Trash2,
  Trophy,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { Avatar, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/format";
import {
  loadBoard,
  loadNudgeSettings,
  loadPendingSuggestions,
  loadStoredRate,
  loadVocabulary,
  refreshRate,
  type Vocabulary,
} from "@/lib/leads/data";
import { createLead, moveLead } from "@/lib/leads/actions";
import { formatIls, formatMoney, isStale, toIls, usdQuote, type StoredRate } from "@/lib/leads/fx";
import { daysInStage, isOverdue, isStalled } from "@/lib/leads/stalled";
import {
  NEW_LEAD_NAME,
  NEW_LEAD_PARAM,
  SOURCES,
  sourceLabel,
  type Lead,
  type LeadSource,
  type LeadStage,
  type LeadSuggestion,
  type LostReason,
} from "@/lib/leads/types";
import { LostModal, WinModal } from "@/components/leads/stage-modals";
import { SourceIcon, StageChip, StageIcon } from "@/lib/leads/look";
import { EmptyState } from "@/components/empty-state";
import { DEFAULT_NUDGES, daysSince, nudgesFor, type Nudge, type NudgeKind, type NudgeSettings } from "@/lib/leads/nudges";
import { loadBoardEstimateHours } from "@/lib/leads/estimates-data";
import { fmtHours, type Range } from "@/lib/leads/estimate";
import { IconSelect } from "@/components/leads/icon-select";
import { SettingsPopupButton } from "@/components/leads/settings-popup";
import { deletedLeadName } from "@/lib/leads/data";
import { eraseLead, restoreLead } from "@/lib/leads/actions";
import { useNewLeads } from "@/components/new-leads";
import { SkeletonCard, SkeletonRows } from "@/components/skeleton";

const LAYOUT_KEY = "leads.layout";
const PANE_KEY = "leads.pane";
const SHOW_LOST_KEY = "leads.list.showLost";
const SHOW_WON_KEY = "leads.list.showWon";

/** The main column's view modes. */
type Layout = "board" | "list";
/** The right pane: one of its two tabs, or folded away. */
type Pane = "today" | "summary" | "closed";

const VIEWS: { value: Layout; label: string; Icon: LucideIcon }[] = [
  { value: "board", label: "Board", Icon: SquareKanban },
  { value: "list", label: "List", Icon: List },
];

/**
 * See `storedLayout` in candidates/page.tsx — effect or handler only, never
 * render. ⚠️ Before v1.71.0 "today" and "summary" were layouts too; a browser
 * that stored one of those opens the board, with that tab picked in the pane.
 */
function stored(): { layout: Layout; pane: Pane } {
  let layout: Layout = "board";
  let pane: Pane = "today";
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "list") layout = "list";
    const p = localStorage.getItem(PANE_KEY);
    if (p === "today" || p === "summary" || p === "closed") pane = p;
    else if (v === "summary") pane = "summary";
  } catch {
    // Private window / blocked storage. The defaults are fine.
  }
  return { layout, pane };
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice just won't stick.
  }
}

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(days / 365)}y`;
}


/** A board column: grows to share the width, shrinks to 15rem before the board scrolls. */
const COLUMN = "flex min-w-[15rem] max-w-[24rem] flex-1 basis-64 flex-col";
/**
 * ⚠️ Each column scrolls ITSELF, inside the screen. Lost holds hundreds of
 * cards; growing the board to fit them put its horizontal scrollbar hundreds
 * of cards down, so whatever sat right of the view was unreachable.
 */
const COLUMN_BODY = "max-h-[calc(100vh-17rem)] overflow-y-auto";

const CHIP_OFF = "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground";
const CHIP_ON = "border-[#c9d6fb] bg-brand-soft font-medium text-brand-dark";

function StalledBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fdf3e3] px-2 py-0.5 text-[11.5px] font-medium text-[#8a5a09]"
      title="No activity for longer than this stage allows"
    >
      <AlarmClock size={12} strokeWidth={2} /> Stalled
    </span>
  );
}

/** The attention line's colours, by kind — the same hues as NUDGE_COLOR, as a
 *  tint with dark ink so the words stay readable. */
const NOTE_TONE: Record<NudgeKind, string> = {
  reply: "bg-[#e11d48]/10 text-[#be123c]",
  overdue: "bg-[#e11d48]/10 text-[#be123c]",
  offer: "bg-brand-soft text-brand-dark",
  estimate: "bg-[#7c3aed]/10 text-[#6d28d9]",
  stalled: "bg-warning/15 text-[#855800]",
  missing: "bg-warning/15 text-[#855800]",
};

function NudgeIcon({ kind }: { kind: NudgeKind }) {
  const Icon = { reply: MailWarning, overdue: CalendarClock, offer: Send, estimate: Calculator, stalled: AlarmClock, missing: CircleDashed }[kind];
  return <Icon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />;
}

function NewBadge() {
  return (
    <span
      title="From the website form — not opened yet"
      className="shrink-0 rounded-full bg-brand px-2 py-px text-[11.5px] font-medium leading-[18px] text-white"
    >
      New
    </span>
  );
}

function LeadCard({
  lead,
  stage,
  ownerName,
  owner,
  valueIls,
  now,
  isNew,
  hours,
  nudge,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  stage: LeadStage | undefined;
  ownerName: string | null;
  owner: Parameters<typeof Avatar>[0]["profile"] | null;
  valueIls: number | null;
  now: Date;
  /** From the website form and not opened yet (0048). */
  isNew: boolean;
  /** The current estimate's hours range, when the lead has one. */
  hours: Range | null;
  /** The one thing to do about this lead, if any — the first of `nudgesFor`. */
  nudge?: Nudge;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const stalled = isStalled(lead, stage, now);
  const overdue = isOverdue(lead, now);
  const open = stage?.kind === "open";
  const daysLate = overdue && lead.nextStepDue ? daysSince(lead.nextStepDue, now) : 0;
  // ⚠️ AN OVERDUE OR MISSING NEXT STEP IS SAID BY THE NEXT-STEP LINE ITSELF —
  // in red, or in amber — so the attention line below never repeats it. Every
  // other nudge (a reply owed, an offer waiting, an unfinished estimate, gone
  // quiet) gets the line, in its own colour.
  const noteNudge = nudge && nudge.kind !== "overdue" && nudge.kind !== "missing" ? nudge : null;
  return (
    <Link
      href={`/leads/${lead.id}`}
      draggable={draggable}
      onDragStart={(e) => {
        liftDrag(e);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="group flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-card"
    >
      {/* Who and how much: the company and its value on one line, the contact
          and the estimate's hours under it. Hierarchy is size and ink, the
          same as a task card on a client board — no coloured band, so the one
          colour a card carries is its attention line. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="bidi-auto min-w-0 text-[15px] font-medium leading-snug text-foreground">
              {lead.company}
            </span>
            {isNew && <NewBadge />}
            {open && lead.replyOwedSince && noteNudge?.kind !== "reply" && (
              <span title={`We owe a reply since ${formatDate(lead.replyOwedSince)}`} className="shrink-0 text-[#b7791f]">
                <MailWarning size={15} strokeWidth={1.75} />
              </span>
            )}
          </div>
          {(valueIls !== null || lead.estValue !== null) && (
            <span
              className="shrink-0 pt-px text-[14px] font-medium tabular-nums text-foreground"
              title={lead.currency === "USD" ? formatMoney(lead.estValue, "USD") : undefined}
            >
              {formatIls(valueIls)}
            </span>
          )}
        </div>
        {(lead.primaryContact || lead.source || hours) && (
          <div className="flex items-center gap-2 text-[13px] leading-tight text-muted">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {(lead.primaryContact || lead.source) && (
                <span title={sourceLabel(lead.source as LeadSource | null)} className="flex">
                  <SourceIcon source={lead.source as LeadSource | null} size={13} className="text-faint" />
                </span>
              )}
              {lead.primaryContact && <span className="bidi-auto truncate">{lead.primaryContact}</span>}
            </span>
            {hours && (
              <span className="shrink-0 text-[12.5px] tabular-nums" title="Hours in the current estimate">
                {fmtHours(hours)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The attention note, ON the card (Board A, 2026-10-23). It used to be a
          bubble floating above the card, which covered the one above it. */}
      {open && noteNudge && (
        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${NOTE_TONE[noteNudge.kind]}`}>
          <NudgeIcon kind={noteNudge.kind} />
          <span className="bidi-auto min-w-0 truncate" title={noteNudge.text}>
            {noteNudge.text}
          </span>
        </div>
      )}

      {open && (
        // ⚠️ A MISSING NEXT STEP IS SHOWN, NOT HIDDEN — the PRD's rule is that
        // no open lead is left without an action, and an empty line reads as
        // "fine" while a named gap reads as a job.
        <div className={`flex gap-2 text-[13px] leading-snug ${!lead.nextStep ? "text-[#855800]" : overdue ? "text-[#be123c]" : ""}`}>
          {lead.nextStep ? (
            <CalendarClock size={14} strokeWidth={1.75} className={`mt-[2px] shrink-0 ${overdue ? "" : "text-muted"}`} aria-hidden />
          ) : (
            <CircleDashed size={14} strokeWidth={1.75} className="mt-[2px] shrink-0" aria-hidden />
          )}
          <span className="bidi-auto line-clamp-3 min-w-0">
            {lead.nextStep ?? "No next step yet"}
            {lead.nextStep && lead.nextStepDue && (
              <span className={overdue ? "font-medium" : "text-muted"}>
                {" "}
                · {overdue ? `${daysLate === 1 ? "1 day" : `${daysLate} days`} late, due ` : ""}
                {formatDate(lead.nextStepDue)}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 text-[12px] text-muted">
        {/* The owner's avatar and first name. (It was a grey chip while the
            attention DOT was the card's one colour; the dot is gone.) */}
        {owner && ownerName ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-foreground" title={ownerName}>
            <Avatar profile={owner} size={20} />
            <span className="truncate">{ownerName.split(" ")[0]}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[13px]">
            <UserRound size={14} strokeWidth={1.75} className="shrink-0" /> Unassigned
          </span>
        )}
        {stalled && noteNudge?.kind !== "stalled" && <StalledBadge />}
        <span className="ml-auto shrink-0" title={open ? "Days in this stage" : "Since it closed"}>
          {open ? `${daysInStage(lead, now)}d in stage` : ago(lead.stageChangedAt)}
        </span>
      </div>
    </Link>
  );
}

/** A summary figure, in the home page's StatTile voice at pane size. */
function Tile({ label, value, sub, hi = false }: { label: string; value: string; sub?: string; hi?: boolean }) {
  // The highlighted tile spans the pane: a shekel figure doesn't fit half of it.
  return (
    <div className={`rounded-xl border p-3.5 ${hi ? "col-span-3 border-brand bg-brand text-white" : "border-border bg-background/60"}`}>
      <div className={`text-[11px] uppercase tracking-wide ${hi ? "text-white/80" : "text-muted"}`}>{label}</div>
      <div className="mt-1.5 font-serif-accent text-[28px] leading-none">{value}</div>
      {sub && <div className={`mt-2 text-[12px] ${hi ? "text-white/85" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

/** A heading inside the pane: a title, and what it counts on the right. */
function PaneHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h3 className="font-heading text-[14px]">{children}</h3>
      {aside && <span className="ml-auto text-[12px] text-faint">{aside}</span>}
    </div>
  );
}

/**
 * The pipeline at a glance (PRD US24) — counting what is already stored, no AI.
 *
 * ⚠️ "DAYS TO WIN" COUNTS ONLY LEADS THAT WERE WORKED IN THE APP — a lead
 * whose `won_at` equals its `created_at` came from the Sheet import already
 * won, and averaging those zeros in would claim the studio closes deals the
 * same day they arrive.
 */
function PipelineSummary({
  leads,
  stageById,
  reasons,
  ils,
  now,
}: {
  leads: Lead[];
  stageById: Map<string, LeadStage>;
  reasons: LostReason[];
  ils: (l: Lead) => number | null;
  now: Date;
}) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const kindOf = (l: Lead) => (l.stageId ? stageById.get(l.stageId)?.kind : undefined) ?? "open";
  const openStages = [...stageById.values()].filter((s) => s.kind === "open").sort((a, b) => a.position - b.position);

  const byStage = openStages.map((s) => {
    const list = leads.filter((l) => l.stageId === s.id);
    return { stage: s, count: list.length, value: list.reduce((n, l) => n + (ils(l) ?? 0), 0) };
  });
  const openTotal = byStage.reduce((n, r) => n + r.value, 0);
  const max = Math.max(1, ...byStage.map((r) => r.value));

  const won = leads.filter((l) => kindOf(l) === "won");
  const lost = leads.filter((l) => kindOf(l) === "lost");
  const wonMonth = won.filter((l) => l.stageChangedAt >= monthStart);
  const lostMonth = lost.filter((l) => l.stageChangedAt >= monthStart);
  const worked = won.filter((l) => l.wonAt && new Date(l.wonAt).getTime() - new Date(l.createdAt).getTime() > 86_400_000);
  const avgDays = worked.length
    ? Math.round(
        worked.reduce((n, l) => n + (new Date(l.wonAt!).getTime() - new Date(l.createdAt).getTime()) / 86_400_000, 0) /
          worked.length,
      )
    : null;
  const lostYear = lost.filter((l) => l.stageChangedAt >= yearAgo);
  const reasonCounts = reasons
    .map((r) => ({ name: r.name, n: lostYear.filter((l) => l.lostReasonId === r.id).length }))
    .concat([{ name: "No reason", n: lostYear.filter((l) => !l.lostReasonId).length }])
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const reasonMax = Math.max(1, ...reasonCounts.map((r) => r.n));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-2.5">
        <Tile hi label="Open pipeline" value={formatIls(openTotal)} sub={`${byStage.reduce((n, r) => n + r.count, 0)} open leads`} />
        <Tile
          label="Won this month"
          value={String(wonMonth.length)}
          sub={formatIls(wonMonth.reduce((n, l) => n + (ils(l) ?? 0), 0))}
        />
        <Tile label="Lost this month" value={String(lostMonth.length)} sub={`${lostYear.length} this year`} />
        <Tile
          label="Avg days to win"
          value={avgDays === null ? "—" : String(avgDays)}
          sub={worked.length ? `across ${worked.length} won` : "none won in the app"}
        />
      </div>

      <section>
        <PaneHeading aside={formatIls(openTotal)}>Open value by stage</PaneHeading>
        <div className="flex flex-col gap-3">
          {byStage.map((r) => (
            <div key={r.stage.id} className="flex flex-col gap-1.5 text-[13px]">
              <div className="flex items-center gap-1.5">
                <StageIcon stage={r.stage} size={14} />
                <span className="bidi-auto min-w-0 truncate">{r.stage.name}</span>
                <span className="text-faint">{r.count}</span>
                <span className="ml-auto tabular-nums text-muted">{formatIls(r.value)}</span>
              </div>
              <span className="h-2 rounded-full bg-foreground/[0.06]">
                <span
                  className="block h-2 rounded-full"
                  style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.stage.color || "var(--color-brand)" }}
                />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <PaneHeading aside="last 12 months">Why leads were lost</PaneHeading>
        <div className="flex flex-col gap-2.5 text-[13px]">
          {reasonCounts.map((r) => (
            <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_88px_28px] items-center gap-3">
              <span className="bidi-auto truncate text-foreground/85">{r.name}</span>
              <span className="h-1.5 rounded-full bg-foreground/[0.06]">
                <span className="block h-1.5 rounded-full bg-foreground/30" style={{ width: `${(r.n / reasonMax) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-muted">{r.n}</span>
            </div>
          ))}
          {reasonCounts.length === 0 && <p className="text-faint">Nothing lost in the last 12 months.</p>}
        </div>
      </section>
    </div>
  );
}

/**
 * What to do first this morning (PRD US23): replies we owe, next steps due,
 * leads gone quiet, leads with no next step.
 *
 * ⚠️ A LEAD APPEARS ONCE, IN THE FIRST LIST THAT CLAIMS IT, in that order. A
 * lead that owes a reply is usually also stalled and often has no next step;
 * listing it three times makes the page look three times as busy as it is.
 */
function todaySections(leads: Lead[], stageById: Map<string, LeadStage>, now: Date, suggestions: LeadSuggestion[]) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const open = leads.filter((l) => {
    const s = l.stageId ? stageById.get(l.stageId) : undefined;
    return !s || s.kind === "open";
  });
  const seen = new Set<string>();
  const take = (list: Lead[]) => list.filter((l) => !seen.has(l.id) && (seen.add(l.id), true));

  // A lead with a pending suggestion is listed there first, with the reason.
  const suggestionFor = new Map(
    suggestions
      .filter((sg) => {
        const l = open.find((x) => x.id === sg.leadId);
        return l && l.stageId !== sg.toStageId;
      })
      .map((sg) => [sg.leadId, sg]),
  );
  const sections: {
    title: string;
    hint: string;
    Icon: LucideIcon;
    tone: string;
    rows: Lead[];
    line: (l: Lead) => string;
  }[] = [
    {
      title: "Suggestions",
      hint: "Accept or dismiss on the lead",
      Icon: Lightbulb,
      tone: "text-brand bg-brand-soft",
      rows: take(open.filter((l) => suggestionFor.has(l.id))),
      line: (l) => {
        const sg = suggestionFor.get(l.id)!;
        return `→ ${stageById.get(sg.toStageId)?.name ?? "?"} · ${sg.reason}`;
      },
    },
    {
      title: "Replies we owe",
      hint: "The last message came from them",
      Icon: MailWarning,
      tone: "text-[#8a5a09] bg-[#fdf3e3]",
      rows: take(
        open.filter((l) => l.replyOwedSince).sort((a, b) => a.replyOwedSince!.localeCompare(b.replyOwedSince!)),
      ),
      line: (l) => `Waiting since ${formatDate(l.replyOwedSince!)}`,
    },
    {
      title: "Next steps due",
      hint: "Due today or overdue",
      Icon: CalendarClock,
      tone: "text-danger bg-danger/10",
      rows: take(
        open
          .filter((l) => l.nextStep && l.nextStepDue && l.nextStepDue <= today)
          .sort((a, b) => a.nextStepDue!.localeCompare(b.nextStepDue!)),
      ),
      line: (l) => `${l.nextStep} · ${l.nextStepDue! < today ? "overdue, " : ""}due ${formatDate(l.nextStepDue!)}`,
    },
    {
      title: "Gone quiet",
      hint: "Past their stage's stall limit",
      Icon: AlarmClock,
      tone: "text-[#8a5a09] bg-[#fdf3e3]",
      rows: take(
        open
          .filter((l) => isStalled(l, l.stageId ? stageById.get(l.stageId) : undefined, now))
          .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt)),
      ),
      line: (l) => `Last activity ${formatDate(l.lastActivityAt)}`,
    },
    {
      title: "No next step",
      hint: "Every open lead needs one",
      Icon: CircleDashed,
      tone: "text-muted bg-foreground/[0.06]",
      rows: take(open.filter((l) => !l.nextStep)),
      line: () => "Add what happens next",
    },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

function TodayList({
  sections,
  stageById,
}: {
  sections: ReturnType<typeof todaySections>;
  stageById: Map<string, LeadStage>;
}) {
  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
          <CircleCheck size={22} strokeWidth={1.75} />
        </span>
        <p className="font-heading text-[15px]">All clear</p>
        <p className="text-[13px] text-muted">Nothing waiting on you — every open lead has a next step on time.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <section key={s.title}>
          <div className="mb-2 flex items-center gap-2.5">
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${s.tone}`}>
              <s.Icon size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 font-heading text-[14px] leading-tight">
                {s.title}
                <span className="rounded-full bg-foreground/[0.06] px-1.5 text-[11.5px] font-medium tabular-nums text-muted">
                  {s.rows.length}
                </span>
              </h3>
              <p className="text-[12px] text-faint">{s.hint}</p>
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            {s.rows.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/leads/${l.id}`}
                  className="group flex items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-background"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="bidi-auto min-w-0 truncate text-[14px] font-medium">{l.company}</span>
                      <StageChip stage={l.stageId ? stageById.get(l.stageId) : undefined} className="ml-auto shrink-0" />
                    </span>
                    <span className="bidi-auto mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{s.line(l)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * One "Show" menu for what the main view holds back — the client page's Show
 * menu (`show-menu.tsx`), in the same voice: switches you flip, a trigger
 * that reports state.
 *
 * ⚠️ Only STALLED ONLY lights the trigger. Won and Lost being hidden is the
 * list's resting state, and a badge that is always on gets ignored — which is
 * how a real filter then goes unnoticed. Won/Lost appear in List view only;
 * the board shows them as folded columns.
 */
function ViewMenu({
  stalledOnly,
  onStalledOnly,
  stalledCount,
  closed,
}: {
  stalledOnly: boolean;
  onStalledOnly: (v: boolean) => void;
  stalledCount: number;
  closed: {
    showWon: boolean;
    wonCount: number;
    onShowWon: (v: boolean) => void;
    showLost: boolean;
    lostCount: number;
    onShowLost: (v: boolean) => void;
  } | null;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Choose what this view shows"
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
          stalledOnly ? CHIP_ON : CHIP_OFF
        }`}
      >
        <SlidersHorizontal size={14} strokeWidth={1.75} />
        Show
        {stalledOnly && <span>· stalled only</span>}
        <ChevronDown size={14} className={stalledOnly ? "" : "text-faint"} />
      </button>
      {open && (
        <div className="pop-in absolute left-0 top-full z-50 mt-1.5 flex w-64 flex-col rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          <MenuSwitch
            Icon={AlarmClock}
            label="Stalled only"
            count={stalledCount}
            checked={stalledOnly}
            onChange={() => onStalledOnly(!stalledOnly)}
          />
          {closed && (
            <>
              <div className="mx-2 my-1 border-t border-border" />
              <MenuSwitch
                Icon={Trophy}
                label="Won leads"
                count={closed.wonCount}
                checked={closed.showWon}
                onChange={() => closed.onShowWon(!closed.showWon)}
              />
              <MenuSwitch
                Icon={CircleX}
                label="Lost leads"
                count={closed.lostCount}
                checked={closed.showLost}
                onChange={() => closed.onShowLost(!closed.showLost)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** An icon, a label with its count, and a switch at the far end (show-menu.tsx's SwitchRow). */
function MenuSwitch({
  Icon,
  label,
  count,
  checked,
  onChange,
}: {
  Icon: LucideIcon;
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] hover:bg-background"
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {label} <span className="tabular-nums text-faint">{count}</span>
      </span>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-border-strong"}`}>
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-all ${checked ? "left-3.5" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export default function LeadsPage() {
  const isAdmin = useIsAdmin();
  const { profiles, currentUserId } = useData();
  const newIds = useNewLeads().ids;
  const router = useRouter();

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [rows, setRows] = useState<Lead[]>([]);
  const [suggestions, setSuggestions] = useState<LeadSuggestion[]>([]);
  const [rate, setRate] = useState<StoredRate | null>(null);
  const [nudgeRules, setNudgeRules] = useState<NudgeSettings>(DEFAULT_NUDGES);
  const [estHours, setEstHours] = useState<Map<string, Range>>(new Map());
  const [layout, setLayout] = useState<Layout>("board");
  const [pane, setPane] = useState<Pane>("today");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [stalledOnly, setStalledOnly] = useState(false);
  /** The list hides won and lost leads unless asked — the closed ones buried the open ones. */
  const [showLost, setShowLost] = useState(false);
  const [showWon, setShowWon] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Won, Lost and empty stages start folded: the board is about what is still moving. */
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ lead: Lead; from: LeadStage | null; to: LeadStage } | null>(null);
  /** One `now` per render pass, so every card agrees on what "stalled" means. */
  const [now] = useState(() => new Date());

  // ⚠️ A REF, not state — see candidates/page.tsx.
  const dragged = useRef<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);

  useEffect(() => {
    const s = stored();
    setLayout(s.layout);
    setPane(s.pane);
    try {
      setShowLost(localStorage.getItem(SHOW_LOST_KEY) === "1");
      setShowWon(localStorage.getItem(SHOW_WON_KEY) === "1");
    } catch {
      // Blocked storage: lost stays hidden.
    }
  }, []);

  const choosePane = (next: Pane) => {
    setPane(next);
    store(PANE_KEY, next);
  };

  // Undo after a delete (0047). The lead page deletes by stamping
  // `deleted_at` and lands here with `?deleted=<id>`; the banner offers Undo,
  // and dismissing it erases the lead for good (otherwise the nightly cron
  // does). The param is spent at once so a reload can't offer it again.
  const [deleted, setDeleted] = useState<{ id: string; company: string } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deleted");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    void deletedLeadName(id).then((company) => {
      if (company !== null) setDeleted({ id, company });
    });
  }, []);

  const reload = useCallback(async () => {
    const [v, b, sg] = await Promise.all([loadVocabulary(), loadBoard(), loadPendingSuggestions()]);
    setVocab(v);
    setRows(b);
    setSuggestions(sg);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const [v, b, r, sg, nr] = await Promise.all([
          loadVocabulary(),
          loadBoard(),
          loadStoredRate(),
          loadPendingSuggestions(),
          loadNudgeSettings().catch(() => DEFAULT_NUDGES),
        ]);
        if (!alive) return;
        setNudgeRules(nr);
        // The cards' hours arrive after the board — they are a detail, and the
        // board must not wait on estimate lines to appear.
        void loadBoardEstimateHours(b.filter((l) => !l.deletedAt).map((l) => l.id)).then((m) => alive && setEstHours(m));
        setVocab(v);
        setRows(b);
        setSuggestions(sg);
        setRate(r);
        setError(null);
        // The rate is refreshed in the background; totals use the stored one
        // (or the fallback) until the bank answers.
        if (isStale(r, new Date())) {
          const fresh = await refreshRate();
          if (alive && fresh) setRate(fresh);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the board.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const quote = useMemo(() => usdQuote(rate), [rate]);
  const stageById = useMemo(() => new Map((vocab?.stages ?? []).map((s) => [s.id, s])), [vocab]);
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((l) => {
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (stalledOnly && !isStalled(l, l.stageId ? stageById.get(l.stageId) : undefined, now)) return false;
      if (!q) return true;
      return (
        l.company.toLowerCase().includes(q) ||
        (l.primaryContact ?? "").toLowerCase().includes(q) ||
        (l.domain ?? "").includes(q) ||
        (l.askedFor ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, sourceFilter, stalledOnly, query, stageById, now]);

  const byStage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    for (const l of visible) {
      const key = l.stageId && stageById.has(l.stageId) ? l.stageId : "";
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    return m;
  }, [visible, stageById]);

  const ils = useCallback((l: Lead) => toIls(l.estValue, l.currency, quote), [quote]);

  const kindOf = useCallback((l: Lead) => (l.stageId ? stageById.get(l.stageId)?.kind : undefined), [stageById]);
  const lostCount = useMemo(() => visible.filter((l) => kindOf(l) === "lost").length, [visible, kindOf]);
  const wonCount = useMemo(() => visible.filter((l) => kindOf(l) === "won").length, [visible, kindOf]);
  const listRows = useMemo(
    () =>
      visible.filter((l) => {
        const k = kindOf(l);
        return k === "lost" ? showLost : k === "won" ? showWon : true;
      }),
    [visible, showLost, showWon, kindOf],
  );

  const summary = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    let openValue = 0;
    let openCount = 0;
    let stalled = 0;
    let wonMonth = 0;
    let lostMonth = 0;
    for (const l of rows) {
      const s = l.stageId ? stageById.get(l.stageId) : undefined;
      if (!s || s.kind === "open") {
        openCount++;
        openValue += ils(l) ?? 0;
        if (isStalled(l, s, now)) stalled++;
      } else if (s.kind === "won" && l.stageChangedAt >= monthStart) wonMonth++;
      else if (s.kind === "lost" && l.stageChangedAt >= monthStart) lostMonth++;
    }
    return { openValue, openCount, stalled, wonMonth, lostMonth };
  }, [rows, stageById, ils, now]);

  // Today follows the filters (it is "what's waiting on ME" when filtered to an
  // owner); Summary always counts the whole pipeline.
  const today = useMemo(
    () => todaySections(visible, stageById, now, suggestions),
    [visible, stageById, now, suggestions],
  );
  const todayCount = today.reduce((n, s) => n + s.rows.length, 0);

  const drop = useCallback(
    async (to: LeadStage) => {
      const id = dragged.current;
      dragged.current = null;
      setDropStage(null);
      if (!id) return;
      const row = rows.find((l) => l.id === id);
      if (!row || row.stageId === to.id) return;
      const from = row.stageId ? (stageById.get(row.stageId) ?? null) : null;
      // ⚠️ WON AND LOST ASK FIRST. Winning makes a client; losing wants a
      // reason. The card stays where it is until the question is answered, so
      // Cancel leaves the board exactly as it was.
      if (to.kind !== "open") {
        setPending({ lead: row, from, to });
        return;
      }
      const at = new Date().toISOString();
      setRows((prev) =>
        prev.map((l) => (l.id === id ? { ...l, stageId: to.id, stageChangedAt: at, lastActivityAt: at } : l)),
      );
      try {
        await moveLead(id, from, to, currentUserId);
      } catch (e) {
        setRows((prev) => prev.map((l) => (l.id === id ? row : l)));
        setError(e instanceof Error ? e.message : "Could not move the lead.");
      }
    },
    [rows, stageById, currentUserId],
  );

  /**
   * ⚠️ STRAIGHT TO THE LEAD PAGE, the candidates pattern: the row is created
   * first ("New lead") because everything on that page saves against an id, and
   * the page selects the name so the first keystroke replaces it.
   */
  const addLead = useCallback(async () => {
    if (!vocab || adding) return;
    setAdding(true);
    try {
      const first = vocab.stages.find((s) => s.kind === "open") ?? null;
      const id = await createLead({ company: NEW_LEAD_NAME, stageId: first?.id ?? null }, currentUserId);
      router.push(`/leads/${id}?${NEW_LEAD_PARAM}=1`);
    } catch (e) {
      setAdding(false);
      setError(e instanceof Error ? e.message : "Could not add the lead.");
    }
  }, [vocab, adding, currentUserId, router]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="page-title">Leads</h1>
        <p className="mt-3 text-sm text-muted">The sales pipeline is for Nitsan and Michal only.</p>
      </div>
    );
  }

  const stages = vocab?.stages ?? [];
  const cardProps = (l: Lead) => ({
    lead: l,
    stage: l.stageId ? stageById.get(l.stageId) : undefined,
    owner: l.ownerId ? (profileById.get(l.ownerId) ?? null) : null,
    ownerName: l.ownerId ? (profileById.get(l.ownerId)?.name ?? null) : null,
    valueIls: ils(l),
    now,
    isNew: newIds.has(l.id),
    hours: estHours.get(l.id) ?? null,
  });
  const dragHandlers = (l: Lead) => ({
    draggable: true,
    onDragStart: () => {
      dragged.current = l.id;
    },
    onDragEnd: () => {
      dragged.current = null;
      setDropStage(null);
    },
  });
  const dropZone = (s: LeadStage) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragged.current) return;
      e.preventDefault();
      setDropStage(s.id);
    },
    onDragLeave: () => setDropStage((p) => (p === s.id ? null : p)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      void drop(s);
    },
  });
  const filtered = sourceFilter !== "all" || stalledOnly || query.trim() !== "";
  const paneOpen = pane !== "closed";

  return (
    // ⚠️ THE WHOLE SCREEN, on purpose (Nitsan, v1.71.0) — seven board columns
    // and the right pane don't fit the 1500px every other page caps at.
    <div className="flex w-full flex-col gap-5">
      {/* ── header: title and the pipeline in one line · the page's actions ── */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="page-title">Leads</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
            <span>
              <span className="font-medium text-foreground">{summary.openCount}</span> open
            </span>
            <span className="text-faint">·</span>
            <span>
              <span className="font-medium text-foreground">{formatIls(summary.openValue)}</span> in play
            </span>
            {summary.stalled > 0 && (
              <>
                <span className="text-faint">·</span>
                <span className="text-[#8a5a09]">{summary.stalled} stalled</span>
              </>
            )}
            <span className="text-faint">·</span>
            <span>
              {summary.wonMonth} won, {summary.lostMonth} lost this month
            </span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SettingsPopupButton
            which="leads"
            label="Settings"
            iconOnly
            onClosed={() => void reload().catch((e) => setError(e instanceof Error ? e.message : "Could not reload."))}
          />
          <button
            onClick={() => void addLead()}
            disabled={adding || !vocab}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[14px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            <Plus size={17} strokeWidth={2} /> {adding ? "Adding…" : "Add lead"}
          </button>
        </div>
      </div>

      {deleted && (
        <div className="notice-in flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-[14px] shadow-card">
          <Trash2 size={15} strokeWidth={1.75} className="text-faint" />
          <span>
            <span className="bidi-auto font-medium">{deleted.company || "The lead"}</span> was deleted.
          </span>
          <button
            onClick={async () => {
              const id = deleted.id;
              setDeleted(null);
              try {
                await restoreLead(id);
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not restore the lead.");
              }
            }}
            className="font-medium text-brand hover:underline"
          >
            Undo
          </button>
          <button
            onClick={() => {
              const id = deleted.id;
              setDeleted(null);
              void eraseLead(id).catch(() => undefined);
            }}
            aria-label="Dismiss"
            title="Dismiss — the lead is erased for good"
            className="ml-auto text-faint hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">{error}</div>}

      <div className={`grid items-start gap-5 ${paneOpen ? "xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        {/* ── main column: the view modes ── */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* view · filters · search · the pane's toggle */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tabs<Layout>
              value={layout}
              onChange={(k) => {
                setLayout(k);
                store(LAYOUT_KEY, k);
              }}
              variant="segmented"
              ariaLabel="View"
              items={VIEWS.map(({ value, label, Icon }) => ({ value, label, icon: Icon }))}
            />
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
            <IconSelect
              value={sourceFilter}
              onChange={setSourceFilter}
              ariaLabel="Filter by source"
              className={`h-9 rounded-full border px-3 text-[13px] ${sourceFilter === "all" ? CHIP_OFF : CHIP_ON}`}
              options={[
                { value: "all", label: "All sources" },
                ...SOURCES.map((s) => ({
                  value: s.value,
                  label: s.label,
                  icon: <SourceIcon source={s.value} className="text-faint" />,
                })),
              ]}
            />
            <ViewMenu
              stalledOnly={stalledOnly}
              onStalledOnly={setStalledOnly}
              stalledCount={summary.stalled}
              closed={
                layout === "list"
                  ? {
                      showWon,
                      wonCount,
                      onShowWon: (v) => {
                        setShowWon(v);
                        store(SHOW_WON_KEY, v ? "1" : "0");
                      },
                      showLost,
                      lostCount,
                      onShowLost: (v) => {
                        setShowLost(v);
                        store(SHOW_LOST_KEY, v ? "1" : "0");
                      },
                    }
                  : null
              }
            />
            {filtered && (
              <button
                onClick={() => {
                  setSourceFilter("all");
                  setStalledOnly(false);
                  setQuery("");
                }}
                className="text-[13px] text-muted hover:text-foreground"
              >
                Clear
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-brand">
                <Search size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search company, contact, domain"
                  className="w-56 bg-transparent text-[14px] outline-none placeholder:text-faint"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="Clear the search">
                    <X size={14} className="text-faint" />
                  </button>
                )}
              </label>
              {!paneOpen && (
                <button
                  onClick={() => choosePane("today")}
                  title="Show Today and Summary"
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] text-muted hover:border-brand hover:text-foreground"
                >
                  <PanelRightOpen size={16} strokeWidth={1.75} />
                  Today
                  {todayCount > 0 && (
                    <span className="rounded-full bg-brand px-1.5 text-[11.5px] font-medium leading-[18px] text-white tabular-nums">
                      {todayCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {busy && <SkeletonCard rows={5} />}

          {!busy && vocab && layout === "board" && (
            <div className="flex items-start gap-3 overflow-x-auto pb-3">
              {stages.map((s) => {
                const list = byStage.get(s.id) ?? [];
                const value = list.reduce((sum, l) => sum + (ils(l) ?? 0), 0);
                // Won and Lost start folded, and so does an open stage with
                // nothing in it (or nothing matching the filters): an empty
                // column is width the board needs for the ones that hold leads.
                // A folded column is still a drop target.
                const foldable = s.kind !== "open" || list.length === 0;
                const folded = foldable && !unfolded.has(s.id);
                const fold = () =>
                  setUnfolded((prev) => {
                    const next = new Set(prev);
                    if (folded) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  });
                // ⚠️ The chevron is the FIRST thing in both shapes, so folding and
                // unfolding never moves it out from under the pointer.
                if (folded) {
                  return (
                    <button
                      key={s.id}
                      {...dropZone(s)}
                      onClick={fold}
                      title={`Show ${s.name}`}
                      // Neutral (2026-10-23): the stage keeps its colour only in
                      // its icon, as on the lead page's stage track. ⚠️ It sits
                      // on the canvas, so a grey hover fill vanished into the
                      // page — it lifts like every clickable card instead
                      // (globals.css), and its arrow and name turn blue.
                      className={`group flex min-h-40 w-12 shrink-0 flex-col items-center gap-2.5 rounded-2xl bg-surface py-3 shadow-card ${
                        dropStage === s.id ? "outline outline-2 outline-brand" : ""
                      }`}
                    >
                      <ChevronRight size={16} className="text-muted group-hover:text-brand" />
                      <StageIcon stage={s} size={16} />
                      <span className="min-w-6 rounded-full bg-track px-1.5 text-center text-xs font-medium leading-5 tabular-nums text-muted">
                        {list.length}
                      </span>
                      <span className="bidi-auto text-[13px] font-medium text-muted group-hover:text-brand [writing-mode:vertical-rl]">
                        {s.name}
                      </span>
                    </button>
                  );
                }
                return (
                  <div key={s.id} className={COLUMN}>
                    <div className="mb-2 flex h-9 items-center gap-2 px-1">
                      {foldable && (
                        <button
                          onClick={fold}
                          title={`Fold ${s.name}`}
                          aria-label={`Fold ${s.name}`}
                          className="-ml-1 rounded text-muted hover:text-foreground"
                        >
                          <ChevronDown size={16} />
                        </button>
                      )}
                      <StageIcon stage={s} size={15} />
                      <span className="bidi-auto min-w-0 truncate text-sm font-medium">{s.name}</span>
                      <span className="rounded-full bg-track px-1.5 text-xs font-medium tabular-nums text-muted">
                        {list.length}
                      </span>
                      {value > 0 && <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted">{formatIls(value)}</span>}
                    </div>
                    <div
                      {...dropZone(s)}
                      className={`flex min-h-40 flex-col gap-2.5 rounded-2xl p-2 transition-colors ${COLUMN_BODY} ${
                        dropStage === s.id ? "bg-brand-soft outline outline-1 outline-brand" : "bg-track/50"
                      }`}
                    >
                      {list.map((l) => (
                        <LeadCard key={l.id} {...cardProps(l)} nudge={nudgesFor(l, s, nudgeRules, now)[0]} {...dragHandlers(l)} />
                      ))}
                      {list.length === 0 && (
                        <p className="px-2 py-6 text-center text-[13px] text-faint">
                          {dropStage === s.id ? "Drop here" : "No leads here"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {(byStage.get("") ?? []).length > 0 && (
                <div className={COLUMN}>
                  <div className="mb-2 flex h-9 items-center gap-2 px-1">
                    <span className="text-sm font-medium text-[#855800]">No stage</span>
                    <span className="rounded-full bg-foreground/[0.06] px-1.5 text-[12px] font-medium tabular-nums text-muted">
                      {(byStage.get("") ?? []).length}
                    </span>
                  </div>
                  <div className={`flex min-h-40 flex-col gap-2.5 rounded-2xl bg-warning/10 p-2 ${COLUMN_BODY}`}>
                    {(byStage.get("") ?? []).map((l) => (
                      <LeadCard key={l.id} {...cardProps(l)} {...dragHandlers(l)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!busy && vocab && layout === "list" && (
            <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
              <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-[14px]">
                <thead>
                  <tr>
                    {["Company", "Stage", "Owner", "Value", "Next step", "Source", "Last activity"].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap border-b border-border bg-background/50 px-3 py-3 text-[11.5px] font-medium uppercase tracking-wide text-muted first:rounded-tl-2xl first:pl-4 last:rounded-tr-2xl"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((l) => {
                    const s = l.stageId ? stageById.get(l.stageId) : undefined;
                    const owner = l.ownerId ? profileById.get(l.ownerId) : null;
                    const overdue = isOverdue(l, now);
                    return (
                      <tr
                        key={l.id}
                        onClick={(e) => {
                          // The whole row opens the lead; the company is the real link for keyboard and ⌘-click.
                          if ((e.target as HTMLElement).closest("a")) return;
                          router.push(`/leads/${l.id}`);
                        }}
                        className="cursor-pointer hover:bg-brand-soft/40"
                      >
                        <td className="border-b border-border py-3 pl-4 pr-3">
                          <Link href={`/leads/${l.id}`} className="flex items-center gap-2">
                            <span className="min-w-0 max-w-[13rem]">
                              <span className="bidi-auto block truncate font-medium">{l.company}</span>
                              {l.primaryContact && (
                                <span className="bidi-auto block truncate text-[12.5px] text-muted">{l.primaryContact}</span>
                              )}
                            </span>
                            {newIds.has(l.id) && <NewBadge />}
                            {isStalled(l, s, now) && <StalledBadge />}
                          </Link>
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          <StageChip stage={s} />
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          {owner ? (
                            <span className="flex items-center gap-2 whitespace-nowrap" title={owner.name}>
                              <Avatar profile={owner} size={22} />
                              <span className="truncate text-foreground/85">{owner.name.split(" ")[0]}</span>
                            </span>
                          ) : (
                            <span className="text-faint">Unassigned</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-3 tabular-nums">
                          {formatIls(ils(l))}
                          {l.currency === "USD" && l.estValue !== null && (
                            <span className="ml-1.5 text-[12.5px] text-faint">{formatMoney(l.estValue, "USD")}</span>
                          )}
                        </td>
                        <td className={`bidi-auto min-w-[13rem] max-w-[28rem] border-b border-border px-3 py-3 ${overdue ? "text-danger" : "text-foreground/85"}`}>
                          {s?.kind === "open" ? (
                            l.nextStep ? (
                              <span className="line-clamp-2">
                                {l.nextStep}
                                {l.nextStepDue && <span className={overdue ? "" : "text-muted"}> · {formatDate(l.nextStepDue)}</span>}
                              </span>
                            ) : (
                              <span className="text-warning">No next step</span>
                            )
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-3 text-muted">
                          <span className="flex items-center gap-1.5">
                            <SourceIcon source={l.source as LeadSource | null} className="text-faint" />
                            {sourceLabel(l.source as LeadSource | null)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-3 text-muted">{ago(l.lastActivityAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {listRows.length === 0 && (
                // ⚠️ Anything in `rows` that isn't listed is hidden by the search,
                // the source and stalled filters, or the won/lost toggles — so
                // "Show every lead" undoes all of them, and is offered only when
                // there is something to show.
                <EmptyState
                  icon={SearchX}
                  text={rows.length > 0 ? "No leads match that." : "No leads yet."}
                  action={
                    rows.length > 0
                      ? {
                          label: "Show every lead",
                          onClick: () => {
                            setQuery("");
                            setSourceFilter("all");
                            setStalledOnly(false);
                            setShowWon(true);
                            setShowLost(true);
                          },
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {!busy && rows.length === 0 && !error && (
            <p className="py-6 text-sm text-faint">
              No leads yet. Add one, or wait for the website form — it lands here as {stages[0]?.name ?? "the first stage"}.
            </p>
          )}
        </div>

        {/* ── right pane: Today · Summary ──
            ⚠️ Sticky under the app header (h-14 + main's p-6 = top-20) and
            scrolling itself, so it stays beside the board however long a
            column runs. Below xl it simply follows the main column. */}
        {paneOpen && (
          <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card xl:sticky xl:top-20 xl:max-h-[calc(100vh-6.5rem)]">
            <div className="flex items-center gap-2 border-b border-border px-5 pt-3.5">
              <Tabs<"today" | "summary">
                value={pane === "summary" ? "summary" : "today"}
                onChange={choosePane}
                ariaLabel="Pipeline pane"
                className="flex-1 gap-5! border-b-0!"
                items={[
                  {
                    value: "today",
                    icon: CalendarCheck,
                    label: (
                      <span className="flex items-center gap-1.5 text-[14px]">
                        Today
                        {todayCount > 0 && (
                          <span
                            className={`rounded-full px-1.5 text-[11.5px] leading-[18px] tabular-nums ${
                              pane === "today" ? "bg-brand text-white" : "bg-foreground/[0.07] text-muted"
                            }`}
                          >
                            {todayCount}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  { value: "summary", label: <span className="text-[14px]">Summary</span>, icon: ChartPie },
                ]}
              />
              <button
                onClick={() => choosePane("closed")}
                title="Hide the pane — more room for the board"
                aria-label="Hide the pane"
                className="-mt-1.5 mb-1 flex size-8 items-center justify-center rounded-lg text-faint hover:bg-background hover:text-foreground"
              >
                <PanelRightClose size={17} strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {busy || !vocab ? (
                <SkeletonRows rows={4} />
              ) : pane === "summary" ? (
                <PipelineSummary leads={rows} stageById={stageById} reasons={vocab.lostReasons} ils={ils} now={now} />
              ) : (
                <>
                  {filtered && (
                    <p className="mb-4 flex items-center gap-1.5 rounded-lg bg-background px-3 py-2 text-[12.5px] text-muted">
                      <ArrowRight size={13} strokeWidth={1.75} aria-hidden /> Showing the filtered leads only.
                    </p>
                  )}
                  <TodayList sections={today} stageById={stageById} />
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {pending && vocab && pending.to.kind === "lost" && (
        <LostModal
          lead={pending.lead}
          from={pending.from}
          to={pending.to}
          reasons={vocab.lostReasons}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            void reload().catch((e) => setError(e instanceof Error ? e.message : "Could not reload."));
          }}
        />
      )}
      {pending && pending.to.kind === "won" && (
        <WinModal
          lead={pending.lead}
          from={pending.from}
          wonStage={pending.to}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            void reload().catch((e) => setError(e instanceof Error ? e.message : "Could not reload."));
          }}
        />
      )}
    </div>
  );
}
