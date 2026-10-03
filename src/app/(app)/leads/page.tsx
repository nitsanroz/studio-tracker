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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  ChartPie,
  ChevronRight,
  Columns3,
  List,
  MailWarning,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import {
  loadBoard,
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
import { IconSelect } from "@/components/leads/icon-select";
import { SettingsPopupButton } from "@/components/leads/settings-popup";
import { loadBin } from "@/lib/leads/data";
import { deleteLeadForGood, purgeDeletedLeads, restoreLead } from "@/lib/leads/actions";

const LAYOUT_KEY = "leads.layout";

/** The view switcher's options, in order, with their icons. */
const VIEWS: { value: "today" | "board" | "list" | "summary"; label: string; Icon: LucideIcon }[] = [
  { value: "today", label: "Today", Icon: Sun },
  { value: "board", label: "Board", Icon: Columns3 },
  { value: "list", label: "List", Icon: List },
  { value: "summary", label: "Summary", Icon: ChartPie },
];

/** See `storedLayout` in candidates/page.tsx — effect or handler only, never render. */
type Layout = "today" | "board" | "list" | "summary";

function storedLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "list" || v === "board" || v === "today" || v === "summary") return v;
  } catch {
    // Private window / blocked storage. The default is fine.
  }
  return "board";
}

function storeLayout(next: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, next);
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

/** Hebrew has no case, so the Latin small-caps heading style is wrong for it. */
const HAS_HEBREW = /[֐-׿]/;
const headingClass = (label: string) =>
  HAS_HEBREW.test(label)
    ? "text-[12px] font-medium text-muted"
    : "text-[12px] font-medium uppercase tracking-wide text-muted";

const CHIP_OFF = "border-border bg-surface text-muted";
const CHIP_ON = "border-[#c9d6fb] bg-brand-soft font-medium text-brand-dark";

function StalledBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fdf3e3] px-1.5 py-0.5 text-[10.5px] font-medium text-[#8a5a09]"
      title="No activity for longer than this stage allows"
    >
      <AlarmClock size={11} strokeWidth={2} /> Stalled
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
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const stalled = isStalled(lead, stage, now);
  const overdue = isOverdue(lead, now);
  const open = stage?.kind === "open";
  return (
    <Link
      href={`/leads/${lead.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5 shadow-[0_1px_2px_rgba(6,17,47,.04)] transition-colors hover:border-brand"
    >
      <div className="flex items-start gap-2">
        <span className="bidi-auto min-w-0 flex-1 text-[15px] font-medium leading-tight">{lead.company}</span>
        {open && lead.replyOwedSince && (
          <span title={`We owe a reply since ${formatDate(lead.replyOwedSince)}`} className="shrink-0 text-[#8a5a09]">
            <MailWarning size={14} strokeWidth={1.75} />
          </span>
        )}
        {stalled && <StalledBadge />}
      </div>
      {(lead.primaryContact || lead.source) && (
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <span title={sourceLabel(lead.source as LeadSource | null)} className="flex">
            <SourceIcon source={lead.source as LeadSource | null} size={12} className="text-faint" />
          </span>
          {lead.primaryContact && <span className="bidi-auto truncate">{lead.primaryContact}</span>}
        </span>
      )}
      {(valueIls !== null || lead.estValue !== null) && (
        <span className="text-[12.5px] font-medium text-foreground">
          {formatIls(valueIls)}
          {lead.currency === "USD" && (
            <span className="ml-1 font-normal text-faint">{formatMoney(lead.estValue, "USD")}</span>
          )}
        </span>
      )}
      {open && (
        // ⚠️ A MISSING NEXT STEP IS SHOWN, NOT HIDDEN — the PRD's rule is that
        // no open lead is left without an action, and an empty line reads as
        // "fine" while a named gap reads as a job.
        <span
          className={`bidi-auto line-clamp-2 text-[11.5px] ${
            lead.nextStep ? (overdue ? "text-danger" : "text-muted") : "italic text-warning"
          }`}
        >
          {lead.nextStep ?? "No next step"}
          {lead.nextStep && lead.nextStepDue && (
            <span className={overdue ? "text-danger" : "text-faint"}> · {formatDate(lead.nextStepDue)}</span>
          )}
        </span>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-faint">
        {owner ? (
          <>
            <Avatar profile={owner} size={18} />
            <span className="truncate">{ownerName}</span>
          </>
        ) : (
          <span>Unassigned</span>
        )}
        <span className="ml-auto shrink-0" title="Days in this stage">
          {open ? `${daysInStage(lead, now)}d in stage` : ago(lead.stageChangedAt)}
        </span>
      </div>
    </Link>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11.5px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 text-[22px] font-medium">{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
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

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Open pipeline" value={formatIls(openTotal)} sub={`${byStage.reduce((n, r) => n + r.count, 0)} leads`} />
        <Tile
          label="Won this month"
          value={String(wonMonth.length)}
          sub={formatIls(wonMonth.reduce((n, l) => n + (ils(l) ?? 0), 0))}
        />
        <Tile label="Lost this month" value={String(lostMonth.length)} />
        <Tile
          label="Avg days to win"
          value={avgDays === null ? "—" : String(avgDays)}
          sub={worked.length ? `across ${worked.length} won in the app` : "no deal won in the app yet"}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold">Open value by stage</h2>
          <div className="mt-3 flex flex-col gap-2">
            {byStage.map((r) => (
              <div key={r.stage.id} className="grid grid-cols-[150px_1fr_90px] items-center gap-3 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-1.5 text-muted">
                  <StageIcon stage={r.stage} />
                  <span className="bidi-auto truncate">{r.stage.name}</span>
                  <span className="text-faint">{r.count}</span>
                </span>
                <span className="h-2 rounded-full bg-foreground/[0.06]">
                  <span
                    className="block h-2 rounded-full"
                    style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.stage.color || "var(--color-brand)" }}
                  />
                </span>
                <span className="text-right">{formatIls(r.value)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold">Why leads were lost · last 12 months</h2>
          <div className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
            {reasonCounts.map((r) => (
              <div key={r.name} className="flex justify-between">
                <span className="text-muted">{r.name}</span>
                <span>{r.n}</span>
              </div>
            ))}
            {reasonCounts.length === 0 && <p className="text-faint">Nothing lost in the last 12 months.</p>}
          </div>
        </div>
      </div>
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
function TodayList({
  leads,
  stageById,
  now,
  suggestions,
}: {
  leads: Lead[];
  stageById: Map<string, LeadStage>;
  now: Date;
  suggestions: LeadSuggestion[];
}) {
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
  const sections: { title: string; hint: string; rows: Lead[]; line: (l: Lead) => string }[] = [
    {
      title: "Suggestions",
      hint: "Accept or dismiss on the lead.",
      rows: take(open.filter((l) => suggestionFor.has(l.id))),
      line: (l) => {
        const sg = suggestionFor.get(l.id)!;
        return `→ ${stageById.get(sg.toStageId)?.name ?? "?"} · ${sg.reason}`;
      },
    },
    {
      title: "Replies we owe",
      hint: "The last message on a thread came from them.",
      rows: take(
        open.filter((l) => l.replyOwedSince).sort((a, b) => a.replyOwedSince!.localeCompare(b.replyOwedSince!)),
      ),
      line: (l) => `waiting since ${formatDate(l.replyOwedSince!)}`,
    },
    {
      title: "Next steps due",
      hint: "Due today or overdue.",
      rows: take(
        open
          .filter((l) => l.nextStep && l.nextStepDue && l.nextStepDue <= today)
          .sort((a, b) => a.nextStepDue!.localeCompare(b.nextStepDue!)),
      ),
      line: (l) => `${l.nextStep} · ${l.nextStepDue! < today ? "overdue, " : ""}due ${formatDate(l.nextStepDue!)}`,
    },
    {
      title: "Gone quiet",
      hint: "Past their stage's stall limit.",
      rows: take(
        open
          .filter((l) => isStalled(l, l.stageId ? stageById.get(l.stageId) : undefined, now))
          .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt)),
      ),
      line: (l) => `last activity ${formatDate(l.lastActivityAt)}`,
    },
    {
      title: "No next step",
      hint: "Every open lead needs one.",
      rows: take(open.filter((l) => !l.nextStep)),
      line: () => "add what happens next",
    },
  ];

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
      {total === 0 && <p className="text-sm text-faint">Nothing waiting on you.</p>}
      {sections
        .filter((s) => s.rows.length > 0)
        .map((s) => (
          <div key={s.title} className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">{s.title}</h2>
              <span className="text-[12px] text-faint">{s.rows.length}</span>
              <span className="ml-auto text-[11.5px] text-faint">{s.hint}</span>
            </div>
            <ul className="mt-2 flex flex-col">
              {s.rows.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/leads/${l.id}`}
                    className="flex items-baseline gap-2 rounded-md px-1.5 py-1.5 hover:bg-brand-soft/50"
                  >
                    <span className="bidi-auto shrink-0 text-[13px] font-medium">{l.company}</span>
                    <span className="bidi-auto min-w-0 truncate text-[12px] text-muted">{s.line(l)}</span>
                    <span className="ml-auto shrink-0">
                      <StageChip stage={l.stageId ? stageById.get(l.stageId) : undefined} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

export default function LeadsPage() {
  const isAdmin = useIsAdmin();
  const { profiles, currentUserId } = useData();
  const router = useRouter();

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [rows, setRows] = useState<Lead[]>([]);
  const [suggestions, setSuggestions] = useState<LeadSuggestion[]>([]);
  const [rate, setRate] = useState<StoredRate | null>(null);
  const [layout, setLayout] = useState<Layout>("board");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [stalledOnly, setStalledOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Won and Lost start folded: the board is about what is still moving. */
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ lead: Lead; from: LeadStage | null; to: LeadStage } | null>(null);
  /** One `now` per render pass, so every card agrees on what "stalled" means. */
  const [now] = useState(() => new Date());

  // ⚠️ A REF, not state — see candidates/page.tsx.
  const dragged = useRef<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);

  useEffect(() => {
    setLayout(storedLayout());
  }, []);

  // Undo after a delete (0047). The lead page deletes by stamping
  // `deleted_at` and lands here with `?binned=<id>`; the banner offers Undo,
  // and dismissing it erases the lead for good. The param is spent at once so
  // a reload can't offer it again. Any deleted lead past its Undo window is
  // erased on every board load.
  const [binned, setBinned] = useState<{ id: string; company: string } | null>(null);
  useEffect(() => {
    void purgeDeletedLeads();
    const id = new URLSearchParams(window.location.search).get("binned");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    void loadBin().then((list) => {
      const hit = list.find((b) => b.id === id);
      if (hit) setBinned({ id: hit.id, company: hit.company });
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
        const [v, b, r, sg] = await Promise.all([
          loadVocabulary(),
          loadBoard(),
          loadStoredRate(),
          loadPendingSuggestions(),
        ]);
        if (!alive) return;
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
  const owners = useMemo(
    () => profiles.filter((p) => p.active && p.role === "admin").sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((l) => {
      if (ownerFilter === "none" ? l.ownerId : ownerFilter !== "all" && l.ownerId !== ownerFilter) return false;
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
  }, [rows, ownerFilter, sourceFilter, stalledOnly, query, stageById, now]);

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
        <h1 className="font-serif-accent text-2xl">Leads</h1>
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

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* ── row 1: title, and the page's two actions on the right ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-serif-accent text-2xl">Leads</h1>
          <p className="mt-0.5 text-sm text-muted">
            {summary.openCount} open · {formatIls(summary.openValue)} in play
            {summary.stalled > 0 && <span className="text-[#8a5a09]"> · {summary.stalled} stalled</span>}
            {" · "}
            {summary.wonMonth} won, {summary.lostMonth} lost this month
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
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-50"
          >
            <Plus size={16} strokeWidth={2} /> {adding ? "Adding…" : "Add lead"}
          </button>
        </div>
      </div>

      {binned && (
        <div className="notice-in mt-3 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
          <Trash2 size={14} strokeWidth={1.75} className="text-faint" />
          <span>
            <span className="bidi-auto font-medium">{binned.company || "The lead"}</span> was deleted.
          </span>
          <button
            onClick={async () => {
              try {
                await restoreLead(binned.id);
                setBinned(null);
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
              const id = binned.id;
              setBinned(null);
              void deleteLeadForGood(id).catch(() => undefined);
            }}
            aria-label="Dismiss"
            title="Dismiss — the lead is erased for good"
            className="ml-auto text-faint hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── row 2: filters left · view centre · search right ──
          ⚠️ A THREE-COLUMN GRID WITH TWO EQUAL `1fr` SIDES, so the view switcher
          sits on the page's true centre whatever the filters and search weigh. */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 justify-self-start">
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            aria-label="Filter by owner"
            className={`h-7 cursor-pointer rounded-full border px-2 text-[11.5px] ${ownerFilter === "all" ? CHIP_OFF : CHIP_ON}`}
          >
            <option value="all">All owners</option>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="none">Unassigned</option>
          </select>
          <IconSelect
            value={sourceFilter}
            onChange={setSourceFilter}
            ariaLabel="Filter by source"
            className={`h-7 rounded-full border px-2.5 text-[11.5px] ${sourceFilter === "all" ? CHIP_OFF : CHIP_ON}`}
            options={[
              { value: "all", label: "All sources" },
              ...SOURCES.map((s) => ({
                value: s.value,
                label: s.label,
                icon: <SourceIcon source={s.value} className="text-faint" />,
              })),
            ]}
          />
          <button
            onClick={() => setStalledOnly((v) => !v)}
            aria-pressed={stalledOnly}
            className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] ${stalledOnly ? CHIP_ON : CHIP_OFF}`}
          >
            <AlarmClock size={13} strokeWidth={1.75} /> Stalled · {summary.stalled}
          </button>
        </div>

        <div className="flex overflow-hidden rounded-lg border border-border bg-surface text-[12.5px]">
          {VIEWS.map(({ value: k, label, Icon }) => (
            <button
              key={k}
              onClick={() => {
                setLayout(k);
                storeLayout(k);
              }}
              aria-pressed={layout === k}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${layout === k ? "bg-brand font-medium text-white" : "text-muted hover:text-foreground"}`}
            >
              <Icon size={14} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <label className="flex h-8 items-center gap-2 justify-self-end rounded-lg border border-border bg-surface px-2.5">
          <Search size={15} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, contact, domain"
            className="w-44 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear the search">
              <X size={13} className="text-faint" />
            </button>
          )}
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      )}
      {busy && <p className="mt-8 text-sm text-muted">Loading…</p>}

      {!busy && vocab && layout === "today" && (
        <TodayList leads={visible} stageById={stageById} now={now} suggestions={suggestions} />
      )}

      {!busy && vocab && layout === "summary" && (
        <PipelineSummary leads={rows} stageById={stageById} reasons={vocab.lostReasons} ils={ils} now={now} />
      )}

      {!busy && vocab && layout === "board" && (
        <div className="mt-5 flex items-start gap-3 overflow-x-auto pb-4">
          {stages.map((s) => {
            const list = byStage.get(s.id) ?? [];
            const value = list.reduce((sum, l) => sum + (ils(l) ?? 0), 0);
            const folded = s.kind !== "open" && !unfolded.has(s.id);
            if (folded) {
              return (
                <button
                  key={s.id}
                  {...dropZone(s)}
                  onClick={() => setUnfolded((prev) => new Set(prev).add(s.id))}
                  title={`Show ${s.name}`}
                  className={`flex min-h-32 w-11 shrink-0 flex-col items-center gap-2 rounded-xl py-3 transition-colors ${
                    dropStage === s.id
                      ? "bg-brand-soft outline outline-1 outline-brand"
                      : s.kind === "won"
                        ? "bg-[#eaf6ee]"
                        : "bg-foreground/[0.035]"
                  }`}
                >
                  <ChevronRight size={14} className="text-faint" />
                  <span className="text-[11px] text-faint">{list.length}</span>
                  <StageIcon stage={s} />
                  <span className={`bidi-auto [writing-mode:vertical-rl] ${headingClass(s.name)}`}>{s.name}</span>
                </button>
              );
            }
            return (
              <div key={s.id} className="w-60 shrink-0">
                <div className="flex items-center gap-1.5 px-1 pb-2">
                  <StageIcon stage={s} />
                  <span className={`bidi-auto ${headingClass(s.name)}`} style={{ color: s.color || undefined }}>
                    {s.name}
                  </span>
                  <span className="text-[11px] text-faint">{list.length}</span>
                  {value > 0 && <span className="ml-auto text-[11px] text-muted">{formatIls(value)}</span>}
                  {s.kind !== "open" && (
                    <button
                      onClick={() =>
                        setUnfolded((prev) => {
                          const next = new Set(prev);
                          next.delete(s.id);
                          return next;
                        })
                      }
                      className="ml-1 text-[11px] text-faint hover:text-foreground"
                    >
                      Fold
                    </button>
                  )}
                </div>
                <div
                  {...dropZone(s)}
                  className={`flex min-h-32 flex-col gap-2 rounded-xl p-2 transition-colors ${
                    dropStage === s.id ? "bg-brand-soft outline outline-1 outline-brand" : "bg-foreground/[0.035]"
                  }`}
                >
                  {list.map((l) => (
                    <LeadCard key={l.id} {...cardProps(l)} {...dragHandlers(l)} />
                  ))}
                </div>
              </div>
            );
          })}

          {(byStage.get("") ?? []).length > 0 && (
            <div className="w-60 shrink-0">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <span className="text-[12px] font-medium uppercase tracking-wide text-warning">No stage</span>
                <span className="text-[11px] text-faint">{(byStage.get("") ?? []).length}</span>
              </div>
              <div className="flex min-h-32 flex-col gap-2 rounded-xl bg-warning/10 p-2">
                {(byStage.get("") ?? []).map((l) => (
                  <LeadCard key={l.id} {...cardProps(l)} {...dragHandlers(l)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!busy && vocab && layout === "list" && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr>
                {["Company", "Stage", "Owner", "Value", "Next step", "Source", "Last activity"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-3 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const s = l.stageId ? stageById.get(l.stageId) : undefined;
                const owner = l.ownerId ? profileById.get(l.ownerId) : null;
                const overdue = isOverdue(l, now);
                return (
                  <tr key={l.id} className="hover:bg-brand-soft/40">
                    <td className="border-b border-border px-3 py-2.5">
                      <Link href={`/leads/${l.id}`} className="flex items-center gap-2">
                        <span className="min-w-0">
                          <span className="bidi-auto block truncate font-medium">{l.company}</span>
                          {l.primaryContact && (
                            <span className="bidi-auto block truncate text-[11.5px] text-faint">{l.primaryContact}</span>
                          )}
                        </span>
                        {isStalled(l, s, now) && <StalledBadge />}
                      </Link>
                    </td>
                    <td className="border-b border-border px-3 py-2.5 text-muted">
                      <StageChip stage={s} />
                    </td>
                    <td className="border-b border-border px-3 py-2.5">
                      {owner ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar profile={owner} size={18} />
                          <span className="truncate text-muted">{owner.name}</span>
                        </span>
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2.5">
                      {formatIls(ils(l))}
                      {l.currency === "USD" && l.estValue !== null && (
                        <span className="ml-1 text-[11.5px] text-faint">{formatMoney(l.estValue, "USD")}</span>
                      )}
                    </td>
                    <td className={`bidi-auto border-b border-border px-3 py-2.5 ${overdue ? "text-danger" : "text-muted"}`}>
                      {s?.kind === "open" ? (
                        l.nextStep ? (
                          <>
                            {l.nextStep}
                            {l.nextStepDue && <span className="text-faint"> · {formatDate(l.nextStepDue)}</span>}
                          </>
                        ) : (
                          <span className="italic text-warning">No next step</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2.5 text-muted">
                      <span className="flex items-center gap-1.5">
                        <SourceIcon source={l.source as LeadSource | null} className="text-faint" />
                        {sourceLabel(l.source as LeadSource | null)}
                      </span>
                    </td>
                    <td className="border-b border-border px-3 py-2.5 text-muted">{ago(l.lastActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && <p className="px-3 py-6 text-sm text-faint">No leads match that.</p>}
        </div>
      )}

      {!busy && rows.length === 0 && !error && (
        <p className="mt-8 text-sm text-faint">
          No leads yet. Add one, or wait for the website form — it lands here as {stages[0]?.name ?? "the first stage"}.
        </p>
      )}

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
