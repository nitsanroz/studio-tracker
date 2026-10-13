"use client";

// One lead: who they are, what they asked for, where it stands, what we sent
// them, and every step on the way — the PRD's "Lead page".
//
// ⚠️ ADMIN-ONLY BY RLS (0042). Built on the candidate page's patterns: every
// write goes through `run()`, which saves and then reloads, so the page always
// shows what the database holds rather than what we hoped it took.

import { askConfirm } from "@/components/confirm-dialog";
import { useNewLeads } from "@/components/new-leads";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import {
  Info,
  ArrowRight,
  ArrowRightLeft,
  Briefcase,
  CalendarClock,
  Check,
  UserRound,
  CircleX,
  RotateCcw,
  Sparkles,
  StickyNote,
  Users,
  type LucideIcon,
  AlarmClock,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  FilePlus2,
  FileText,
  History,
  Lightbulb,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { IconSelect } from "@/components/leads/icon-select";
import { NEUTRAL, SourceIcon, STAGE_ICONS, StageIcon } from "@/lib/leads/look";
import { Avatar, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { isSafeUrl, normalizeUrl } from "@/lib/links";
import { leadFileHref, uploadLeadFile } from "@/lib/overview-files";
import {
  loadLead,
  loadNudgeSettings,
  loadStoredRate,
  loadThreadMessages,
  loadVocabulary,
  searchGmailForLead,
  type Vocabulary,
} from "@/lib/leads/data";
import {
  addContact,
  addOffer,
  approveOffer,
  deleteLead,
  restoreLead,
  linkThread,
  logActivity,
  moveLead,
  removeActivity,
  removeContact,
  removeOffer,
  unlinkThread,
  updateContact,
  updateLead,
  updateOffer,
  decideSuggestion,
  type ContactFields,
  type RuleContext,
} from "@/lib/leads/actions";
import { formatIls, formatMoney, toIls, usdQuote, type StoredRate } from "@/lib/leads/fx";
import { daysInStage, isOverdue, isStalled, quietWorkDays } from "@/lib/leads/stalled";
import {
  gmailThreadIdFromUrl,
  LOGGABLE,
  NEW_LEAD_PARAM,
  OFFER_STATUSES,
  SOURCES,
  sourceLabel,
  type Currency,
  type LeadContact,
  type LeadDetail,
  type LeadEvent,
  type LeadEventKind,
  type LeadMessage,
  type LeadOffer,
  type LeadSource,
  type LeadStage,
  type OfferStatus,
} from "@/lib/leads/types";
import { LostModal, WinModal } from "@/components/leads/stage-modals";
import { SettingsPopupButton } from "@/components/leads/settings-popup";
import {
  copyEstimate,
  createEstimate,
  createEstimateFromImport,
  loadEstimateSources,
  loadEstimates,
  type EstimateSource,
  type EstimateSourcePhase,
  type EstimateSummary,
} from "@/lib/leads/estimates-data";
import { Modal, ModalClose } from "@/components/ui";
import { AttentionTip } from "@/components/leads/attention-tip";
import { EstimateImportPanel } from "@/components/leads/estimate-import-panel";
import type { ImportedEstimate } from "@/lib/leads/estimate-import";
import { DEFAULT_NUDGES, nudgesFor, type NudgeKind, type NudgeSettings } from "@/lib/leads/nudges";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";

type Tab = "emails" | "offers" | "estimates" | "activity";

/** A field that looks like text until you reach for it. */
const QUIET =
  "rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:bg-surface focus:outline-none";

/** An uncontrolled input that commits on blur / Enter and resets on Escape. */
function InlineInput({
  value,
  placeholder,
  onCommit,
  className = "",
  type = "text",
  inputRef,
}: {
  value: string | null;
  placeholder?: string;
  onCommit: (next: string | null) => void;
  className?: string;
  type?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      type={type}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== (value ?? "")) onCommit(v || null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value ?? "";
          e.currentTarget.blur();
        }
      }}
      className={`${QUIET} ${className}`}
    />
  );
}

const EVENT_LABEL: Record<LeadEventKind, string> = {
  created: "Lead created",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
  email: "Email",
  stage_change: "Stage",
  offer: "Offer",
  won: "Won",
  lost: "Lost",
  reopened: "Reopened",
};

/** One icon per activity kind — on the log form's kind switch and on each row of the log. */
const EVENT_ICON: Record<LeadEventKind, LucideIcon> = {
  created: Sparkles,
  call: Phone,
  meeting: Users,
  note: StickyNote,
  email: Mail,
  stage_change: ArrowRightLeft,
  offer: FileText,
  won: Trophy,
  lost: CircleX,
  reopened: RotateCcw,
};

function eventLine(ev: LeadEvent): string | null {
  const from = typeof ev.meta?.from === "string" ? ev.meta.from : null;
  const to = typeof ev.meta?.to === "string" ? ev.meta.to : null;
  if (ev.kind === "stage_change" || ev.kind === "reopened") return from ? `${from} → ${to}` : to;
  return null;
}

export default function LeadPage() {
  const isAdmin = useIsAdmin();
  const { profiles, clients, currentUserId } = useData();
  const router = useRouter();
  const params = useParams<{ leadId: string }>();
  const id = params.leadId;
  // Opening a lead is what clears it from the bell and the sidebar (0048).
  const { markSeen } = useNewLeads();
  useEffect(() => markSeen(id), [id, markSeen]);

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [rate, setRate] = useState<StoredRate | null>(null);
  const [busy, setBusy] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [pending, setPending] = useState<{ from: LeadStage | null; to: LeadStage; suggestionId?: string } | null>(
    null,
  );
  const [now] = useState(() => new Date());
  const [nudgeRules, setNudgeRules] = useState<NudgeSettings>(DEFAULT_NUDGES);

  const reload = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([loadVocabulary(), loadLead(id)]);
      setVocab(v);
      if (!d) setMissing(true);
      else setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this lead.");
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      await reload();
      const [r, nr] = await Promise.all([loadStoredRate(), loadNudgeSettings().catch(() => DEFAULT_NUDGES)]);
      if (!alive) return;
      setRate(r);
      setNudgeRules(nr);
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

  // ⚠️ "Add lead" lands here with `?new=1`: focus and SELECT the placeholder
  // name, once, then spend the flag — the candidate page's rule and reasons.
  const nameRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const ready = Boolean(detail);
  useEffect(() => {
    if (!ready || focused.current) return;
    if (!new URLSearchParams(window.location.search).has(NEW_LEAD_PARAM)) return;
    focused.current = true;
    nameRef.current?.focus();
    nameRef.current?.select();
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // The flag is already spent in `focused`.
    }
  }, [ready]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const owners = useMemo(
    () => profiles.filter((p) => p.active && p.role === "admin").sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );
  const quote = useMemo(() => usdQuote(rate), [rate]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="font-serif-accent text-2xl">Leads</h1>
        <p className="mt-3 text-sm text-muted">The sales pipeline is for Nitsan and Michal only.</p>
      </div>
    );
  }
  if (busy) return <p className="py-10 text-sm text-muted">Loading…</p>;
  if (missing)
    return (
      <div className="py-10">
        <p className="text-sm text-muted">That lead no longer exists.</p>
        <Link href="/leads" className="mt-2 inline-block text-sm text-brand">
          Back to the board
        </Link>
      </div>
    );
  if (!detail || !vocab) return <p className="py-10 text-sm text-danger">{error}</p>;

  const { lead: l, contacts, offers, threads, events, suggestions } = detail;
  const stage = vocab.stages.find((s) => s.id === l.stageId) ?? null;
  const stalled = isStalled(l, stage ?? undefined, now);
  const overdue = isOverdue(l, now);
  const open = !stage || stage.kind === "open";
  // Each attention tip sits on the place you act on it: a reply on Emails, an
  // estimate on Estimates, a late or missing next step on the Next step card.
  const tips = nudgesFor(l, stage ?? undefined, nudgeRules, now);
  const tip = (...kinds: NudgeKind[]) => tips.find((n) => kinds.includes(n.kind));
  const tabTip = (label: string, kinds: NudgeKind[]) => (
    <AttentionTip nudge={tip(...kinds)} leadId={l.id} className="inline-block">
      {label}
    </AttentionTip>
  );
  const wonClient = l.clientId ? clients.find((c) => c.id === l.clientId) : null;
  const lostReason = l.lostReasonId ? vocab.lostReasons.find((r) => r.id === l.lostReasonId) : null;
  const valueIls = toIls(l.estValue, l.currency, quote);

  /**
   * Accepting a suggestion is the same move the stage picker makes — Won and
   * Lost still open their modals (a client to create, a reason to give) — and
   * the suggestion is marked accepted only once the move actually happened.
   */
  const acceptSuggestion = (id: string, toStageId: string) => {
    const to = vocab.stages.find((x) => x.id === toStageId);
    if (!to) return;
    if (to.kind !== "open") {
      setPending({ from: stage, to, suggestionId: id });
      return;
    }
    void run(async () => {
      await moveLead(l.id, stage, to, currentUserId);
      await decideSuggestion(id, "accepted", currentUserId);
    });
  };

  const changeStage = (to: LeadStage) => {
    if (to.id === l.stageId) return;
    if (to.kind !== "open") setPending({ from: stage, to });
    else void run(() => moveLead(l.id, stage, to, currentUserId));
  };

  const openStages = vocab.stages.filter((s) => s.kind === "open");
  const closedStages = vocab.stages.filter((s) => s.kind !== "open");

  return (
    // ⚠️ The whole screen, like the board (v1.71.0): the tabs get the width,
    // the deal sits in a fixed column beside them.
    <div className="flex w-full flex-col gap-5">
      <div>
        <Link href="/leads" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-foreground">
          <ChevronLeft size={16} strokeWidth={1.75} /> Leads
        </Link>
      </div>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">{error}</div>}

      {l.deletedAt && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-[14px] shadow-card">
          <Trash2 size={15} strokeWidth={1.75} className="text-faint" />
          <span>This lead was deleted and is hidden from the board. It will be erased for good tonight.</span>
          <button
            onClick={() => void run(() => restoreLead(l.id))}
            className="ml-auto h-9 rounded-lg bg-brand px-3.5 text-[13.5px] font-medium text-white hover:bg-brand-dark"
          >
            Undo
          </button>
        </div>
      )}

      {/* ── header: the company, what it is, and the one destructive action ── */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1">
          <input
            ref={nameRef}
            key={l.company}
            defaultValue={l.company}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== l.company) void run(() => updateLead(l.id, { company: v }));
              else e.target.value = l.company;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Company"
            className={`bidi-auto -ml-1 w-full max-w-3xl font-serif-accent text-[36px] leading-tight ${QUIET}`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
            {l.source && (
              <>
                <span className="flex items-center gap-1.5">
                  <SourceIcon source={l.source as LeadSource} size={14} className="text-faint" />
                  {sourceLabel(l.source as LeadSource)}
                </span>
                <span className="text-faint">·</span>
              </>
            )}
            <span>Created {formatDate(l.createdAt)}</span>
            {open && stage && (
              <>
                <span className="text-faint">·</span>
                <span>
                  {daysInStage(l, now)}d in {stage.name}
                </span>
              </>
            )}
            <span className="text-faint">·</span>
            <span>Last activity {formatDate(l.lastActivityAt)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-2">
          {!l.deletedAt && (
            <button
              onClick={async () => {
                // Confirmed (Nitsan asked to keep it) even though the board
                // offers Undo right after.
                if (
                  !(await askConfirm(`Delete ${l.company || "this lead"}? You can undo it from the Leads page for a few minutes.`, {
                    action: "Delete",
                    danger: true,
                  }))
                )
                  return;
                try {
                  await deleteLead(l.id, currentUserId);
                  router.push(`/leads?deleted=${l.id}`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not delete the lead.");
                }
              }}
              aria-label="Delete the lead"
              title="Delete"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13.5px] text-muted hover:border-danger/40 hover:text-danger"
            >
              <Trash2 size={15} strokeWidth={1.75} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* ── where it stands: the open stages as one track, then the two ways out ──
          ⚠️ Won and Lost still ask first (a client to convert, a reason), through
          `changeStage` — the same path the old stage picker took. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <ol className="flex min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-surface shadow-card [scrollbar-width:none]">
          {openStages.map((s, i) => {
            const at = stage?.id === s.id;
            const idx = stage && open ? openStages.findIndex((x) => x.id === stage.id) : open ? -1 : openStages.length;
            const passed = i < idx;
            const color = s.color || NEUTRAL;
            return (
              <li key={s.id} className="min-w-[9rem] flex-1 border-l border-border first:border-l-0">
                <button
                  onClick={() => changeStage(s)}
                  aria-current={at ? "step" : undefined}
                  title={at ? `${s.name} — current stage` : `Move to ${s.name}`}
                  className={`flex h-12 w-full items-center justify-center gap-2 px-3 text-[14px] transition-colors ${
                    at ? "font-medium text-white" : passed ? "hover:brightness-95" : "text-muted hover:bg-background hover:text-foreground"
                  }`}
                  style={at ? { backgroundColor: color } : passed ? { backgroundColor: `${color}12`, color } : undefined}
                >
                  {at ? (
                    <StageIconWhite stage={s} />
                  ) : passed ? (
                    <Check size={15} strokeWidth={2.25} aria-hidden />
                  ) : (
                    <StageIcon stage={s} size={15} />
                  )}
                  <span className="bidi-auto truncate">{s.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {closedStages.map((s) => {
          const at = stage?.id === s.id;
          const color = s.color || NEUTRAL;
          return (
            <button
              key={s.id}
              onClick={() => changeStage(s)}
              aria-current={at ? "step" : undefined}
              title={at ? `${s.name} — current stage` : `Mark as ${s.name.toLowerCase()}`}
              className={`flex h-12 items-center gap-2 rounded-xl border px-4 text-[14px] font-medium shadow-card transition-colors ${
                at ? "text-white" : "bg-surface hover:brightness-95"
              }`}
              style={at ? { backgroundColor: color, borderColor: color } : { color, borderColor: `${color}55` }}
            >
              {at ? <StageIconWhite stage={s} /> : <StageIcon stage={s} size={15} />}
              <span className="bidi-auto">{s.name}</span>
            </button>
          );
        })}
      </div>

      {/* ── suggestions (Phase 3, rule-based) ── */}
      {suggestions
        .filter((sg) => sg.toStageId !== l.stageId)
        .map((sg) => {
          const to = vocab.stages.find((x) => x.id === sg.toStageId);
          return (
            <div
              key={sg.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-[#c9d6fb] bg-brand-soft px-4 py-3 text-[14px]"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-brand">
                <Lightbulb size={16} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-brand-dark">Move to {to?.name ?? "?"}?</span>{" "}
                <span className="bidi-auto text-muted">{sg.reason}</span>
              </span>
              <button
                onClick={() => acceptSuggestion(sg.id, sg.toStageId)}
                className="h-9 rounded-lg bg-brand px-3.5 text-[13.5px] font-medium text-white hover:bg-brand-dark"
              >
                Accept
              </button>
              <button
                onClick={() => void run(() => decideSuggestion(sg.id, "dismissed", currentUserId))}
                className="h-9 rounded-lg border border-border bg-surface px-3.5 text-[13.5px] text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          );
        })}

      {/* ── banners ── */}
      {stalled && stage && (
        <div className="flex items-center gap-3 rounded-xl border border-[#f3dfb8] bg-[#fdf3e3] px-4 py-3 text-[14px] text-[#8a5a09]">
          <AlarmClock size={17} strokeWidth={1.75} className="shrink-0" />
          <span>
            <span className="font-medium">Stalled</span> — no activity for {quietWorkDays(l.lastActivityAt, now)} working
            days, past the {stage.stallDays}-day limit for {stage.name}. Log a call or email to clear it.
          </span>
        </div>
      )}
      {stage?.kind === "won" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#cde8d6] bg-[#eaf6ee] px-4 py-3 text-[14px] text-[#12693d]">
          <Trophy size={17} strokeWidth={1.75} className="shrink-0" />
          <span className="font-medium">Won{l.wonAt ? ` on ${formatDate(l.wonAt)}` : ""}.</span>
          {l.clientId && (
            <Link href={`/clients/${l.clientId}`} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-[#12693d] px-3.5 text-[13.5px] font-medium text-white hover:brightness-110">
              Open {wonClient?.name ?? "the client"} <ArrowRight size={15} />
            </Link>
          )}
          {!l.clientId && (
            <Link href={`/leads/${l.id}/convert`} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-[#12693d] px-3.5 text-[13.5px] font-medium text-white hover:brightness-110">
              Create the client page <ArrowRight size={15} />
            </Link>
          )}
        </div>
      )}
      {stage?.kind === "lost" && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[14px] text-muted">
          <CircleX size={17} strokeWidth={1.75} className="shrink-0 text-faint" />
          <span>
            <span className="font-medium text-foreground">Lost{lostReason ? ` — ${lostReason.name}` : ""}</span>
            {l.lostNote && <span className="bidi-auto"> · {l.lostNote}</span>}
          </span>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── main: what happened, what we sent ── */}
        <div className="min-w-0 rounded-2xl border border-border bg-surface shadow-card">
          <div className="border-b border-border px-5 pt-4">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              className="gap-6! border-b-0!"
              items={[
                { value: "activity", label: tabTip("Activity", ["stalled"]), count: events.length },
                { value: "emails", label: tabTip("Emails", ["reply"]), count: threads.length },
                { value: "offers", label: tabTip("Offers", ["offer"]), count: offers.length },
                { value: "estimates", label: tabTip("Estimates", ["estimate"]) },
              ]}
            />
          </div>
          <div className="p-5">
            {tab === "activity" && (
              <ActivityTab
                events={events}
                profileById={profileById}
                onLog={(kind, body, at) =>
                  run(() => logActivity(l.id, kind, body, at, l.lastActivityAt, currentUserId))
                }
                onRemove={(evId) => run(() => removeActivity(evId))}
              />
            )}
            {tab === "emails" && (
              <EmailsTab
                leadId={l.id}
                threads={threads}
                backfilledAt={l.gmailBackfilledAt}
                onLink={(url, subject) =>
                  run(() => linkThread(l.id, url, gmailThreadIdFromUrl(url), subject, currentUserId))
                }
                onUnlink={(t) => run(() => unlinkThread(t.id, l.id, t.gmailThreadId))}
                onSearched={reload}
              />
            )}
            {tab === "estimates" && (
              <EstimatesTab
                leadId={l.id}
                company={l.company}
                clientId={l.clientId}
                profileName={(id) => profileById.get(id)?.name ?? null}
              />
            )}
            {tab === "offers" && (
              <OffersTab
                leadId={l.id}
                offers={offers}
                defaultCurrency={l.currency}
                profileById={profileById}
                quoteRate={quote.rate}
                run={run}
                currentUserId={currentUserId}
                onError={setError}
                rules={{ current: stage ?? undefined, stages: vocab.stages }}
              />
            )}
          </div>
        </div>

        {/* ── side: what's next, the deal, who ──
            ⚠️ Contacts live here rather than in a tab (v1.71.0): who you're
            talking to is what you want in view while logging a call or reading
            a thread, not one click away from it. */}
        <div className="flex min-w-0 flex-col gap-4">
          <SideCard
            Icon={CalendarClock}
            title={
              <AttentionTip nudge={tip("overdue", "missing")} leadId={l.id} className="inline-block">
                Next step
              </AttentionTip>
            }
            tone={open && !l.nextStep ? "warning" : overdue ? "danger" : "brand"}
          >
            <textarea
              key={`n${l.nextStep}`}
              defaultValue={l.nextStep ?? ""}
              placeholder={open ? "Every open lead needs one — what happens next?" : "—"}
              rows={3}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== l.nextStep) void run(() => updateLead(l.id, { nextStep: v }));
              }}
              className={`bidi-auto -mx-1 w-[calc(100%+0.5rem)] resize-y text-[15px] leading-relaxed ${QUIET} ${open && !l.nextStep ? "placeholder:text-warning" : ""}`}
            />
            <label className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[14px]">
              <span className="w-20 shrink-0 text-muted">Due</span>
              <input
                type="date"
                key={`d${l.nextStepDue}`}
                defaultValue={l.nextStepDue ?? ""}
                onChange={(e) => void run(() => updateLead(l.id, { nextStepDue: e.target.value || null }))}
                className={`${QUIET} ${overdue ? "text-danger" : "text-foreground"}`}
              />
              {overdue && (
                <span className="ml-auto rounded-full bg-danger/10 px-2 py-0.5 text-[12px] font-medium text-danger">Overdue</span>
              )}
            </label>
          </SideCard>

          <SideCard Icon={Briefcase} title="The deal">
            <div className="text-[13.5px] text-muted">Estimated value</div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={1000}
                key={`v${l.estValue}`}
                defaultValue={l.estValue ?? ""}
                placeholder="Add a value"
                aria-label="Estimated value"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== l.estValue && (v === null || Number.isFinite(v)))
                    void run(() => updateLead(l.id, { estValue: v }));
                }}
                className={`-ml-1 w-44 font-serif-accent text-[30px] leading-tight placeholder:font-sans placeholder:text-[15px] placeholder:not-italic placeholder:text-faint ${QUIET}`}
              />
              <select
                value={l.currency}
                onChange={(e) => void run(() => updateLead(l.id, { currency: e.target.value as Currency }))}
                className={`${QUIET} cursor-pointer text-[14px] text-muted`}
                aria-label="Currency"
              >
                <option value="ILS">₪ ILS</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
            {l.currency === "USD" && l.estValue !== null && (
              <p className="mt-0.5 text-[12.5px] text-muted" title="Bank of Israel rate, 5% worse">
                ≈ {formatIls(valueIls)} at {quote.rate.toFixed(3)}
                {quote.date ? ` (BoI ${formatDate(quote.date)} − 5%)` : " (fallback rate)"}
              </p>
            )}

            <dl className="mt-4 flex flex-col divide-y divide-border border-t border-border text-[14px]">
              <div className="flex items-center gap-2 py-2">
                <dt className="w-20 shrink-0 text-muted">Owner</dt>
                <dd className="min-w-0 flex-1">
                  <select
                    value={l.ownerId ?? ""}
                    onChange={(e) => void run(() => updateLead(l.id, { ownerId: e.target.value || null }))}
                    className={`${QUIET} -ml-1 max-w-full cursor-pointer`}
                    aria-label="Owner"
                  >
                    <option value="">Unassigned</option>
                    {owners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="flex items-center gap-2 py-2">
                <dt className="w-20 shrink-0 text-muted">Source</dt>
                <dd className="min-w-0 flex-1">
                  <IconSelect
                    value={l.source ?? ""}
                    onChange={(v) => void run(() => updateLead(l.id, { source: (v || null) as LeadSource | null }))}
                    ariaLabel="Source"
                    className={`${QUIET} -ml-1`}
                    options={[
                      { value: "", label: "Not set" },
                      ...SOURCES.map((s) => ({
                        value: s.value,
                        label: s.label,
                        icon: <SourceIcon source={s.value} className="text-faint" />,
                      })),
                    ]}
                  />
                </dd>
              </div>
              <div className="flex items-center gap-2 py-2">
                <dt className="w-20 shrink-0 text-muted">Website</dt>
                <dd className="flex min-w-0 flex-1 items-center gap-1.5">
                  <InlineInput
                    key={`w${l.website}`}
                    value={l.website}
                    placeholder="Add a website"
                    onCommit={(v) => void run(() => updateLead(l.id, { website: v }))}
                    className="-ml-1 min-w-0 flex-1"
                  />
                  {l.website && isSafeUrl(normalizeUrl(l.website) ?? "") && (
                    <a
                      href={normalizeUrl(l.website) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open the website"
                      className="shrink-0 text-faint hover:text-brand"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-2 border-t border-border pt-3">
              <div className="mb-1 text-[14px] text-muted">What they asked for</div>
              <textarea
                key={`a${l.askedFor}`}
                defaultValue={l.askedFor ?? ""}
                placeholder="Brand, website, deck…"
                rows={3}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== l.askedFor) void run(() => updateLead(l.id, { askedFor: v }));
                }}
                className={`bidi-auto -mx-1 w-[calc(100%+0.5rem)] resize-y text-[14px] leading-relaxed ${QUIET}`}
              />
            </div>
            {l.sheetRef && <p className="mt-2 text-[12.5px] text-faint">Imported from the Sheet ({l.sheetRef})</p>}
          </SideCard>

          <SideCard
            Icon={Users}
            title={
              <>
                Contacts <span className="ml-1 text-[13px] font-normal text-faint">{contacts.length}</span>
              </>
            }
            action={
              <button
                onClick={() => void run(() => addContact(l.id, { name: "" }, contacts.length + 1))}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-brand hover:bg-brand-soft"
              >
                <Plus size={15} /> Add
              </button>
            }
          >
            <ContactsList
              contacts={contacts}
              onSave={(c, f) => run(() => updateContact(c.id, l.id, f))}
              onRemove={async (c) => {
                if (await askConfirm(`Remove ${c.name || "this contact"} from this lead?`, { action: "Remove", danger: true }))
                  void run(() => removeContact(c.id, l.id));
              }}
            />
          </SideCard>
        </div>
      </div>

      {pending && pending.to.kind === "lost" && (
        <LostModal
          lead={l}
          from={pending.from}
          to={pending.to}
          reasons={vocab.lostReasons}
          onClose={() => setPending(null)}
          onDone={() => {
            const sid = pending.suggestionId;
            setPending(null);
            void run(async () => {
              if (sid) await decideSuggestion(sid, "accepted", currentUserId);
            });
          }}
        />
      )}
      {pending && pending.to.kind === "won" && (
        <WinModal
          lead={l}
          from={pending.from}
          wonStage={pending.to}
          onClose={() => setPending(null)}
          onDone={() => {
            const sid = pending.suggestionId;
            setPending(null);
            void run(async () => {
              if (sid) await decideSuggestion(sid, "accepted", currentUserId);
            });
          }}
        />
      )}
    </div>
  );
}

/** A stage's icon in white, for the filled (current) step. */
function StageIconWhite({ stage }: { stage: LeadStage }) {
  const Icon = stage.icon ? STAGE_ICONS[stage.icon] : undefined;
  return Icon ? (
    <Icon size={15} strokeWidth={2} className="shrink-0" aria-hidden />
  ) : (
    <span className="inline-block size-2 shrink-0 rounded-full bg-white" aria-hidden />
  );
}

const SIDE_TONE = {
  brand: "bg-brand-soft text-brand",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-foreground/[0.06] text-muted",
} as const;

/** A card in the lead's side column: an icon, a title, an optional action, the body. */
function SideCard({
  Icon,
  title,
  action,
  tone = "neutral",
  children,
}: {
  Icon: LucideIcon;
  title: React.ReactNode;
  action?: React.ReactNode;
  tone?: keyof typeof SIDE_TONE;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border bg-surface shadow-card ${tone === "warning" ? "border-warning/50" : "border-border"}`}
    >
      {/* The header strip every card in the app uses (the home page's cards):
          the title sits on its own band, ruled off from the content. */}
      <div className="flex min-h-12 items-center gap-2.5 border-b border-border px-5 py-2.5">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${SIDE_TONE[tone]}`}>
          <Icon size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="min-w-0 flex-1 font-heading text-[15px]">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── activity ────────────────────────────────────────────────────────────────

function ActivityTab({
  events,
  profileById,
  onLog,
  onRemove,
}: {
  events: LeadEvent[];
  profileById: Map<string, Parameters<typeof Avatar>[0]["profile"]>;
  onLog: (kind: LeadEventKind, body: string, at: string | null) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<LeadEventKind>("call");
  const [body, setBody] = useState("");
  const [at, setAt] = useState("");
  const [saving, setSaving] = useState(false);
  const logged = new Set<LeadEventKind>(["call", "meeting", "note", "email"]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim() || saving) return;
          setSaving(true);
          void onLog(kind, body, at || null).finally(() => {
            setSaving(false);
            setBody("");
            setAt("");
          });
        }}
        className="flex flex-col gap-3 rounded-xl border border-border bg-background/60 p-3.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="What happened" className="flex rounded-lg border border-border bg-surface p-0.5">
            {LOGGABLE.map((k) => {
              const Icon = EVENT_ICON[k.value];
              return (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13.5px] transition-colors ${
                    kind === k.value ? "bg-brand-soft font-medium text-brand-dark" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden />
                  {k.label}
                </button>
              );
            })}
          </div>
          <label className="ml-auto flex items-center gap-2 text-[13.5px] text-muted">
            When
            <input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-[13.5px] text-foreground outline-none focus:border-brand"
            />
            {!at && <span className="text-faint">today</span>}
          </label>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
          placeholder="What was said, what was agreed…"
          className="bidi-auto w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-[14.5px] leading-relaxed outline-none placeholder:text-faint focus:border-brand"
        />
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-faint">⌘ Enter to log</span>
          <button
            type="submit"
            disabled={!body.trim() || saving}
            className="ml-auto h-9 rounded-lg bg-brand px-4 text-[14px] font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            {saving ? "Saving…" : `Log ${LOGGABLE.find((k) => k.value === kind)?.label.toLowerCase() ?? "it"}`}
          </button>
        </div>
      </form>

      {/* The history as a timeline: one node per event on a thin rail. */}
      <ol className="mt-6 flex flex-col">
        {events.map((ev, i) => {
          const who = ev.actorId ? profileById.get(ev.actorId) : null;
          const line = eventLine(ev);
          const Icon = EVENT_ICON[ev.kind];
          const last = i === events.length - 1;
          return (
            <li key={ev.id} className="group relative flex gap-4 pb-5 last:pb-0">
              {!last && <span className="absolute bottom-0 left-[17px] top-9 w-px bg-border" aria-hidden />}
              <span className="relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted">
                {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px]">
                  <span className="font-medium">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
                  {line && <span className="bidi-auto text-muted">{line}</span>}
                  {who && (
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <span className="text-faint">·</span>
                      <Avatar profile={who} size={18} /> {who.name}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px] text-faint">
                    {logged.has(ev.kind) && (
                      <button
                        onClick={async () => {
                          if (await askConfirm("Remove this entry?", { action: "Remove", danger: true })) void onRemove(ev.id);
                        }}
                        aria-label="Remove this entry"
                        className="opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    {formatDate(ev.at)}
                  </span>
                </div>
                {ev.body && (
                  <p className="bidi-auto mt-1.5 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-[14px] leading-relaxed text-foreground/85">
                    {ev.body}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {events.length === 0 && <p className="text-[14px] text-faint">Nothing logged yet.</p>}
      </ol>
    </div>
  );
}

// ── contacts ────────────────────────────────────────────────────────────────

function ContactsList({
  contacts,
  onSave,
  onRemove,
}: {
  contacts: LeadContact[];
  onSave: (c: LeadContact, f: ContactFields) => Promise<void>;
  onRemove: (c: LeadContact) => void;
}) {
  if (contacts.length === 0) return <p className="text-[14px] text-faint">No contacts yet.</p>;
  const row = (Icon: React.ReactNode, input: React.ReactNode) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex w-4 shrink-0 justify-center text-faint">{Icon}</span>
      {input}
    </span>
  );
  return (
    <div className="flex flex-col divide-y divide-border">
      {contacts.map((c) => (
        <div key={c.id} className="group flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <InlineInput
                value={c.name === "Unnamed" ? null : c.name}
                placeholder="Name"
                onCommit={(v) => void onSave(c, { name: v ?? "" })}
                className="bidi-auto -ml-1 text-[15px] font-medium"
              />
              <InlineInput
                value={c.title}
                placeholder="Title"
                onCommit={(v) => void onSave(c, { title: v })}
                className="bidi-auto -ml-1 text-[13.5px] text-muted"
              />
            </div>
            <button
              onClick={() => onRemove(c)}
              aria-label={`Remove ${c.name}`}
              className="mt-1 text-faint opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="mt-1 flex flex-col gap-0.5 text-[14px]">
            {row(
              <Mail size={14} strokeWidth={1.75} />,
              <InlineInput
                value={c.email}
                placeholder="Email"
                type="email"
                onCommit={(v) => void onSave(c, { email: v })}
                className="min-w-0 flex-1"
              />,
            )}
            {row(
              <Phone size={14} strokeWidth={1.75} />,
              <InlineInput
                value={c.phone}
                placeholder="Phone"
                onCommit={(v) => void onSave(c, { phone: v })}
                className="min-w-0 flex-1"
              />,
            )}
            {row(
              <SourceIcon source="linkedin" size={13} />,
              <InlineInput
                value={c.linkedin}
                placeholder="LinkedIn"
                onCommit={(v) => void onSave(c, { linkedin: v })}
                className="min-w-0 flex-1 text-muted"
              />,
            )}
            {row(
              <UserRound size={14} strokeWidth={1.75} />,
              <InlineInput
                value={c.persona}
                placeholder="Persona"
                onCommit={(v) => void onSave(c, { persona: v })}
                className="bidi-auto min-w-0 flex-1 text-muted"
              />,
            )}
            {row(
              <History size={14} strokeWidth={1.75} />,
              <InlineInput
                value={c.pastConnection}
                placeholder="Past connection"
                onCommit={(v) => void onSave(c, { pastConnection: v })}
                className="bidi-auto min-w-0 flex-1 text-muted"
              />,
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── emails ──────────────────────────────────────────────────────────────────

const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : formatDate(iso);
};

function OwedBadge({ by }: { by: "us" | "them" | null }) {
  if (!by) return null;
  return by === "us" ? (
    <span className="shrink-0 rounded-full bg-[#fdf3e3] px-1.5 py-0.5 text-[11.5px] font-medium text-[#8a5a09]">
      We owe a reply
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[11.5px] text-muted">Waiting on them</span>
  );
}

/** One thread, folded to its digest; opened, its messages oldest first. */
function ThreadRow({
  t,
  onUnlink,
}: {
  t: LeadDetail["threads"][number];
  onUnlink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LeadMessage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const synced = t.messageCount > 0;
  const outside = t.participants.filter((p) => !/@(studionmore\.com|nmore\.co)$/i.test(p));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && synced && messages === null) {
      loadThreadMessages(t.id)
        .then(setMessages)
        .catch((e) => setErr(e instanceof Error ? e.message : "Could not load the messages."));
    }
  };

  return (
    <li className="group rounded-lg border border-border">
      <div className="flex items-start gap-2 px-3 py-2">
        <Mail size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
        <button onClick={toggle} disabled={!synced} className="min-w-0 flex-1 text-left disabled:cursor-default">
          <span className="flex items-center gap-2">
            <span className="bidi-auto min-w-0 truncate text-[14px] font-medium">{t.subject || "(no subject)"}</span>
            <OwedBadge by={t.replyOwedBy} />
          </span>
          {synced && (
            <span className="mt-0.5 block truncate text-[12.5px] text-faint">
              {outside.slice(0, 3).join(", ")}
              {outside.length > 3 ? ` +${outside.length - 3}` : ""} · {t.messageCount} message
              {t.messageCount === 1 ? "" : "s"} · last {ago(t.lastMessageAt)}
              {t.matchedBy && t.matchedBy !== "manual" && ` · matched by ${t.matchedBy}`}
            </span>
          )}
          {t.digest && !open && (
            <span className="bidi-auto mt-0.5 block line-clamp-1 text-[13px] text-muted">{t.digest}</span>
          )}
          {!synced && <span className="mt-0.5 block text-[12.5px] text-faint">Linked by hand · {formatDate(t.createdAt)}</span>}
        </button>
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Gmail"
          title="Open in Gmail"
          className="mt-0.5 shrink-0 text-faint hover:text-brand"
        >
          <ExternalLink size={13} />
        </a>
        <button
          onClick={async () => {
            if (await askConfirm("Unlink this thread from the lead? It won't be attached to this lead again.", { action: "Unlink", danger: true }))
              onUnlink();
          }}
          aria-label="Unlink"
          title="Unlink — wrong lead"
          className="mt-0.5 shrink-0 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
          {err && <p className="text-[13px] text-danger">{err}</p>}
          {!err && messages === null && <p className="text-[13px] text-faint">Loading…</p>}
          {(messages ?? []).map((m) => (
            <div key={m.id} className={`rounded-lg px-3 py-2 ${m.fromUs ? "bg-brand-soft/50" : "bg-background"}`}>
              <div className="mb-1 flex items-baseline gap-2 text-[12.5px]">
                <span className="font-medium text-foreground">{m.fromName || m.fromAddr}</span>
                {m.fromName && <span className="text-faint">{m.fromAddr}</span>}
                <span className="ml-auto shrink-0 text-faint">{m.sentAt ? formatDate(m.sentAt) : ""}</span>
              </div>
              <p className="bidi-auto line-clamp-[12] whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">
                {m.bodyText || "(no text)"}
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function EmailsTab({
  leadId,
  threads,
  backfilledAt,
  onLink,
  onUnlink,
  onSearched,
}: {
  leadId: string;
  threads: LeadDetail["threads"];
  backfilledAt: string | null;
  onLink: (url: string, subject: string | null) => Promise<void>;
  onUnlink: (t: LeadDetail["threads"][number]) => Promise<void>;
  onSearched: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [subject, setSubject] = useState("");
  const [bad, setBad] = useState(false);
  const [byHand, setByHand] = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const search = useCallback(
    async (quiet: boolean) => {
      setSearching(true);
      if (!quiet) setNote(null);
      try {
        const r = await searchGmailForLead(leadId);
        if (r.accounts === 0) setNote("No mailbox is connected yet — connect Gmail in Settings → Leads.");
        else if (!quiet || r.threads > 0)
          setNote(r.threads ? `Found ${r.threads} thread${r.threads === 1 ? "" : "s"}.` : "Nothing new in the last 12 months.");
        await onSearched();
      } catch (e) {
        if (!quiet) setNote(e instanceof Error ? e.message : "Gmail search failed.");
      } finally {
        setSearching(false);
      }
    },
    [leadId, onSearched],
  );

  // ⚠️ THE FIRST TIME THIS TAB OPENS, THE MAILBOX IS SEARCHED BY ITSELF — once
  // per lead, then only on the button. Quiet: before Gmail is set up the route
  // answers 503 and nothing on screen should complain about it.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || backfilledAt) return;
    auto.current = true;
    void search(true);
  }, [backfilledAt, search]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void search(false)}
          disabled={searching}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13.5px] hover:border-brand disabled:opacity-50"
        >
          <Search size={13} /> {searching ? "Searching Gmail…" : "Search Gmail"}
        </button>
        <span className="text-[12.5px] text-faint">
          {backfilledAt ? `Searched ${ago(backfilledAt)} · new mail arrives on its own` : "Matches by contact email, then company domain"}
        </span>
        <button onClick={() => setByHand((v) => !v)} className="ml-auto text-[13px] text-muted hover:text-foreground">
          {byHand ? "Cancel" : "Link a thread by hand"}
        </button>
      </div>
      {note && <p className="mb-3 text-[13px] text-muted">{note}</p>}
      {byHand && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const u = normalizeUrl(url);
            if (!u || !isSafeUrl(u)) {
              setBad(true);
              return;
            }
            setBad(false);
            void onLink(u, subject.trim() || null).then(() => {
              setUrl("");
              setSubject("");
              setByHand(false);
            });
          }}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mail.google.com/mail/u/0/#inbox/…"
            className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-[13.5px]"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="bidi-auto w-48 rounded-md border border-border px-2 py-1.5 text-[13.5px]"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="h-9 rounded-lg bg-brand px-3 text-[13.5px] font-medium text-white disabled:opacity-40"
          >
            Link
          </button>
          {bad && <p className="w-full text-[13px] text-danger">That address could not be read.</p>}
        </form>
      )}
      <ul className="flex flex-col gap-1.5">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} onUnlink={() => void onUnlink(t)} />
        ))}
        {threads.length === 0 && <p className="text-[13.5px] text-faint">No threads yet.</p>}
      </ul>
    </div>
  );
}

// ── estimates ───────────────────────────────────────────────────────────────

const EST_STATUS: Record<string, string> = {
  draft: "bg-background text-muted",
  in_review: "bg-[#fdf3e3] text-[#8a5a09]",
  approved: "bg-[#eaf6ee] text-[#12693d]",
};

/**
 * "New estimate" — blank, or a copy of any estimate to edit (Nitsan,
 * 2026-10-03): an earlier version for this lead, an estimate made for the same
 * client, or another project's quote as a template.
 *
 * ⚠️ SAME CLIENT MEANS THE SAME `client_id` OR THE SAME COMPANY NAME: a
 * returning client's earlier lead was usually never won into a client, so the
 * name is the only thing joining them.
 */
/**
 * What a "start from" estimate holds, beside the row being hovered: its total,
 * then each phase with its hours and lines. Sits to the RIGHT of the modal
 * (left if the window runs out) so it never covers the list being chosen from.
 * `fixed` + portalled — the modal is a scroller and would clip it.
 */
function EstimateSourceCard({ src, rect }: { src: EstimateSource; rect: DOMRect }) {
  const W = 300;
  const right = rect.right + 12 + W <= window.innerWidth - 8;
  const left = right ? rect.right + 12 : Math.max(8, rect.left - 12 - W);
  // Rows in the lower half hang the card UPWARD from their bottom edge, so a
  // tall card never runs off the foot of the window.
  const low = rect.top > window.innerHeight / 2;
  const vertical = low
    ? { bottom: Math.max(8, window.innerHeight - rect.bottom - 8) }
    : { top: Math.max(8, rect.top - 8) };
  // The row already says the price, the hours and the phase names — so the
  // card is the NEXT level down: every line with its own hours, plus the rate
  // and discount the price was built from.
  const MAX_LINES = 10;
  const tag = (l: EstimateSourcePhase["lines"][number]) => (l.alternative ? "option" : l.optional ? "extra" : null);
  return createPortal(
    <div
      role="tooltip"
      // The finance plan's explain card (finance-admin explain-card.tsx): the
      // same navy, gradient strip and type scale, so a hover card reads the
      // same in both products.
      className="pointer-events-none fixed z-[80] max-h-[85vh] overflow-hidden rounded-2xl bg-[#06112f] text-white shadow-2xl ring-1 ring-white/10"
      style={{ left, width: W, ...vertical }}
    >
      <div className="h-1 bg-gradient-to-r from-[#0b43ed] to-[#6181e8]" />
      <div className="p-3.5">
        <div className="flex items-baseline gap-2 text-[10px] font-medium uppercase tracking-wider text-white/50">
          <span className="bidi-auto min-w-0 truncate">
            {src.company} v{src.version}
          </span>
          <span className="ml-auto shrink-0 normal-case tracking-normal tabular-nums">
            {src.rate} NIS/h{src.discountPercent ? ` · −${src.discountPercent}%` : ""}
          </span>
        </div>
        {src.changeNote && (
          <p className="mt-2 rounded-lg border-l-2 border-[#6181e8] bg-[#0b43ed]/20 px-2.5 py-1.5 text-[11.5px] leading-snug text-white/90">
            {src.changeNote}
          </p>
        )}
        {src.phases.length === 0 ? (
          <p className="mt-2.5 text-[11px] text-white/40">No lines yet.</p>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            {src.phases.map((p, i) => (
              <div key={i} className="text-[11px]">
                <div className="flex justify-between gap-3 border-b border-white/10 pb-0.5">
                  <span className="bidi-auto truncate font-medium text-white/90">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-white/60">{fmtHours(p.hours)}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {p.lines.slice(0, MAX_LINES).map((l, k) => (
                    <li key={k} className="flex justify-between gap-3">
                      <span className="bidi-auto min-w-0 truncate text-white/70">
                        {l.name}
                        {tag(l) && <span className="text-white/35"> · {tag(l)}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-white/90">{fmtHours(l.hours).replace(" hrs", "h")}</span>
                    </li>
                  ))}
                  {p.lines.length > MAX_LINES && (
                    <li className="text-white/35">+ {p.lines.length - MAX_LINES} more</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function NewEstimateModal({
  leadId,
  company,
  clientId,
  onClose,
}: {
  leadId: string;
  company: string;
  clientId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { currentUserId } = useData();
  const [sources, setSources] = useState<EstimateSource[] | null>(null);
  const [pick, setPick] = useState<string>("blank");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<{ src: EstimateSource; rect: DOMRect } | null>(null);
  // "From a Claude conversation": the estimate the import panel read, or null while
  // nothing valid has been pasted. The panel reads; this modal is what writes.
  const [imported, setImported] = useState<ImportedEstimate | null>(null);

  useEffect(() => {
    let alive = true;
    void loadEstimateSources().then((v) => alive && setSources(v));
    return () => {
      alive = false;
    };
  }, []);

  const name = company.trim().toLowerCase();
  const groups: { title: string; rows: EstimateSource[] }[] = [
    { title: "This lead", rows: (sources ?? []).filter((x) => x.leadId === leadId) },
    {
      title: "Same client",
      rows: (sources ?? []).filter(
        (x) => x.leadId !== leadId && ((clientId && x.clientId === clientId) || x.company.trim().toLowerCase() === name),
      ),
    },
  ];
  const used = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
  groups.push({ title: "Other projects", rows: (sources ?? []).filter((x) => !used.has(x.id)) });

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const id =
        pick === "blank"
          ? await createEstimate(leadId, company, currentUserId)
          : pick === "import"
            ? await createEstimateFromImport(leadId, company, imported!, currentUserId)
            : await copyEstimate(pick, leadId, company, currentUserId);
      router.push(`/leads/${leadId}/estimates/${id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create the estimate.");
      setBusy(false);
    }
  }

  // "Based on past estimates" is a mode: `pick` is "copy" until a version is chosen,
  // then that version's id. The list of versions only shows in that mode (Nitsan).
  const copying = pick !== "blank" && pick !== "import";
  const option = (
    value: string,
    title: React.ReactNode,
    sub?: string,
    o: { checked?: boolean; onSelect?: () => void; name?: string } = {},
  ) => {
    const checked = o.checked ?? pick === value;
    return (
    <label
      key={value}
      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[14px] ${
        checked ? "border-brand bg-brand-soft/40" : "border-border hover:border-brand/50"
      }`}
    >
      <input
        type="radio"
        name={o.name ?? "est-source"}
        checked={checked}
        onChange={o.onSelect ?? (() => setPick(value))}
        className="mt-1"
      />
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        {sub && <span className="block truncate text-[12.5px] text-muted">{sub}</span>}
      </span>
    </label>
    );
  };

  return (
    <Modal onClose={onClose} width="lg" align="center" className="max-h-[85vh] overflow-y-auto" labelledBy="new-est-title">
      {/* The three ways to start, pinned at the top while the content below scrolls,
          and drawn as cards so they read as the CHOICE rather than as one more row of
          the version list underneath (Nitsan). `-mx-4 -mt-4` bleeds the bar over the
          Modal's p-4 so content scrolling under it never shows at its edges. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <h3 id="new-est-title" className="text-sm font-semibold">
            New estimate for {company}
          </h3>
          <span className="ml-auto">
            <ModalClose onClose={onClose} />
          </span>
        </div>
        <div role="radiogroup" aria-label="How to start" className="grid grid-cols-3 gap-2">
          {(
            [
              { key: "blank", Icon: FilePlus2, title: "Blank", sub: "Build it from the library" },
              { key: "import", Icon: Sparkles, title: "From Claude", sub: "Paste a conversation's estimate" },
              { key: "copy", Icon: History, title: "Past estimates", sub: "Start from an earlier version" },
            ] as const
          ).map(({ key, Icon, title, sub }) => {
            const on = key === "copy" ? copying : pick === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => (key === "copy" ? !copying && setPick("copy") : setPick(key))}
                className={`flex flex-col items-start gap-1.5 rounded-xl border-2 p-3 text-left transition-colors ${
                  on ? "border-brand bg-brand text-white" : "border-border bg-background/60 hover:border-brand/40 hover:bg-brand-soft/40"
                }`}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden className={on ? "text-white" : "text-brand"} />
                <span className="text-[14.5px] font-medium leading-tight">{title}</span>
                <span className={`text-[12.5px] leading-snug ${on ? "text-white/80" : "text-muted"}`}>{sub}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {pick === "import" && <EstimateImportPanel company={company} onParsed={setImported} />}
        {pick === "blank" && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13.5px] text-muted">
            One empty section to start; add items from the service library.
          </p>
        )}
        {copying && sources === null && <p className="text-[13.5px] text-faint">Loading estimates…</p>}
        {copying && groups.map((g) =>
          g.rows.length ? (
            <div key={g.title} className="mt-2">
              <div className="mb-1 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-faint">
                Copy {g.title === "Other projects" ? "another project's estimate" : `from ${g.title.toLowerCase()}`}
                <span className="ml-auto flex items-center gap-1 font-normal tracking-normal normal-case text-muted">
                  <Info size={12} strokeWidth={1.75} aria-hidden /> Hover for details
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    onMouseEnter={(e) => setHover({ src: r, rect: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {option(
                      r.id,
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <span className="font-medium">{r.company}</span> v{r.version}
                            <span className="ml-1.5 text-[12.5px] text-muted">
                              {r.status === "approved" ? "approved" : r.status === "in_review" ? "in review" : "draft"}
                            </span>
                          </span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {r.phases.map((p) => p.name).join(" · ") || "no phases"} · {formatDate(r.createdAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-medium tabular-nums">{fmtNis(r.net)}</span>
                          <span className="block text-[12.5px] tabular-nums text-muted">{fmtHours(r.hours)}</span>
                        </span>
                      </span>,
                      undefined,
                      { name: "est-copy-source" },
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null,
        )}
        {copying && sources?.length === 0 && (
          <p className="mt-1 text-[13px] text-faint">No other estimates yet — once there are, any of them can be the starting point.</p>
        )}
      </div>
      {copying && (
        <p className="mt-3 text-[12.5px] text-muted">
          Copies every phase, line, option and the texts into a new draft. The other company&rsquo;s name in the texts
          is replaced with {company}; check the greeting.
        </p>
      )}
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {hover && <EstimateSourceCard src={hover.src} rect={hover.rect} />}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-[13.5px]">
          Cancel
        </button>
        <button
          onClick={() => void start()}
          disabled={busy || (pick === "import" && !imported) || pick === "copy"}
          className="h-9 rounded-lg bg-brand px-3 text-[13.5px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : pick === "blank" ? "Start blank" : pick === "import" ? "Create draft" : "Copy and edit"}
        </button>
      </div>
    </Modal>
  );
}

function EstimatesTab({
  leadId,
  company,
  clientId,
  profileName,
}: {
  leadId: string;
  company: string;
  clientId: string | null;
  profileName: (id: string) => string | null;
}) {
  const [list, setList] = useState<EstimateSummary[] | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadEstimates(leadId).then((v) => alive && setList(v));
    return () => {
      alive = false;
    };
  }, [leadId]);

  return (
    <div className="flex flex-col gap-2">
      {list === null && <p className="text-[13.5px] text-faint">Loading…</p>}
      {(list ?? []).map((e) => (
        // ⚠️ A container, not one big Link: the client-link button is an anchor
        // too, and an <a> inside an <a> is invalid HTML (the browser re-parents
        // it — the same family as the nested-button bug in v1.18.0).
        <div
          key={e.id}
          className="flex items-center rounded-lg border border-border hover:border-brand"
        >
          <Link
            href={`/leads/${leadId}/estimates/${e.id}`}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5"
          >
            <span className="text-[14.5px] font-medium">v{e.version}</span>
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${EST_STATUS[e.status]}`}>
              {e.status === "in_review" ? "In review" : e.status === "approved" ? "Approved" : "Draft"}
            </span>
            <span className="text-[14px] tabular-nums">
              {fmtHours(e.hours)} · {fmtNis(e.net)} + VAT
            </span>
            {e.changeNote && <span className="bidi-auto min-w-0 truncate text-[13px] text-muted">{e.changeNote}</span>}
            <span className="ml-auto text-[12.5px] text-faint">
              {e.approvedBy ? `approved by ${profileName(e.approvedBy) ?? "?"} · ` : ""}
              {formatDate(e.createdAt)}
            </span>
          </Link>
          {e.shareToken && (
            <a
              href={`/estimate/${e.shareToken}`}
              target="_blank"
              rel="noreferrer"
              title="Open the page the client sees — the version last published"
              className="mr-2 flex shrink-0 items-center gap-1 rounded-full border border-[#cde8d6] bg-[#eaf6ee] px-2.5 py-1 text-[13px] text-[#12693d] hover:border-[#12693d]"
            >
              <ExternalLink size={12} /> Client link
            </a>
          )}
        </div>
      ))}
      {list?.length === 0 && <p className="text-[13.5px] text-faint">No estimate yet.</p>}
      {choosing && (
        <NewEstimateModal leadId={leadId} company={company} clientId={clientId} onClose={() => setChoosing(false)} />
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div>
        <button
          onClick={() => setChoosing(true)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[13px] text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={13} /> New estimate…
        </button>
        {list && list.length > 0 && (
          <p className="mt-1 text-[12.5px] text-faint">Start blank or from any earlier estimate — this client&rsquo;s or another project&rsquo;s.</p>
        )}
        </div>
        <span className="ml-auto">
          <SettingsPopupButton which="pricing" label="Settings" />
        </span>
      </div>
    </div>
  );
}

// ── offers ──────────────────────────────────────────────────────────────────


function OffersTab({
  leadId,
  offers,
  defaultCurrency,
  profileById,
  quoteRate,
  run,
  currentUserId,
  onError,
  rules,
}: {
  leadId: string;
  offers: LeadOffer[];
  defaultCurrency: Currency;
  profileById: Map<string, Parameters<typeof Avatar>[0]["profile"]>;
  quoteRate: number;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  currentUserId: string;
  onError: (msg: string | null) => void;
  rules: RuleContext;
}) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [status, setStatus] = useState<OfferStatus>("in_review");
  const [sentAt, setSentAt] = useState("");
  const [scope, setScope] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const nextVersion = Math.max(0, ...offers.map((o) => o.version)) + 1;

  async function save() {
    setSaving(true);
    onError(null);
    try {
      const uploaded = file ? { path: await uploadLeadFile(leadId, file), name: file.name } : null;
      await run(() =>
        addOffer(
          leadId,
          nextVersion,
          {
            amount: amount === "" ? null : Number(amount),
            currency,
            status,
            sentAt: sentAt || null,
            scopeSummary: scope || null,
            storagePath: uploaded?.path ?? null,
            fileName: uploaded?.name ?? null,
          },
          currentUserId,
          rules,
        ),
      );
      setAdding(false);
      setAmount("");
      setScope("");
      setSentAt("");
      setFile(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the offer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {offers.map((o) => {
        const approver = o.approvedBy ? profileById.get(o.approvedBy) : null;
        return (
          <div key={o.id} className="group rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-[14px] font-medium">v{o.version}</span>
              <span className="text-[16px] font-medium">{formatMoney(o.amount, o.currency)}</span>
              {o.currency === "USD" && o.amount !== null && (
                <span className="text-[12.5px] text-faint">≈ {formatIls(o.amount * quoteRate)}</span>
              )}
              <select
                value={o.status}
                onChange={(e) =>
                  void run(() =>
                    updateOffer(o.id, leadId, o.version, { status: e.target.value as OfferStatus }, currentUserId, rules),
                  )
                }
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-[13px]"
                aria-label="Offer status"
              >
                {OFFER_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[13px] text-faint">
                Sent
                <input
                  type="date"
                  key={`s${o.sentAt}`}
                  defaultValue={o.sentAt ?? ""}
                  onChange={(e) =>
                    void run(() => updateOffer(o.id, leadId, o.version, { sentAt: e.target.value || null }, currentUserId))
                  }
                  className={`${QUIET} text-muted`}
                />
              </label>
              {o.storagePath && (
                <a
                  href={leadFileHref(o.storagePath)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[13px] text-muted hover:text-brand"
                >
                  <FileText size={13} /> {o.fileName ?? "File"}
                </a>
              )}
              <span className="ml-auto flex items-center gap-2">
                {o.approvedAt ? (
                  <span className="flex items-center gap-1 text-[13px] text-[#12693d]">
                    <CheckCircle2 size={13} /> Approved{approver ? ` by ${approver.name}` : ""} ·{" "}
                    {formatDate(o.approvedAt)}
                  </span>
                ) : (
                  <button
                    onClick={() => void run(() => approveOffer(o.id, leadId, o.version, currentUserId))}
                    className="rounded-lg border border-border px-2 py-0.5 text-[13px] hover:border-brand hover:text-brand"
                  >
                    Approve
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (await askConfirm(`Remove offer v${o.version}?`, { action: "Remove", danger: true }))
                      void run(() => removeOffer(o.id, leadId));
                  }}
                  aria-label={`Remove v${o.version}`}
                  className="text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
            {o.scopeSummary && (
              <p className="bidi-auto mt-1.5 whitespace-pre-wrap text-[13.5px] text-muted">{o.scopeSummary}</p>
            )}
          </div>
        );
      })}
      {offers.length === 0 && !adding && <p className="text-[13.5px] text-faint">No offers yet.</p>}

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand-soft/30 p-3"
        >
          <div className="text-[14px] font-medium">New offer · v{nextVersion}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              step={100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              autoFocus
              className="w-36 rounded-md border border-border bg-surface px-2 py-1.5 text-[14px]"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[14px]"
            >
              <option value="ILS">₪ ILS</option>
              <option value="USD">$ USD</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OfferStatus)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[14px]"
            >
              {OFFER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-muted">
              Sent
              <input
                type="date"
                value={sentAt}
                onChange={(e) => setSentAt(e.target.value)}
                className="rounded-md border border-border bg-surface px-1.5 py-1 text-[13.5px]"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[13px] text-muted hover:border-brand hover:text-brand">
              <Upload size={12} /> {file ? file.name : "Attach the file"}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={2}
            placeholder="Scope summary — what this version includes"
            className="bidi-auto w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[14px]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-lg bg-brand px-3 text-[13.5px] font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Add offer"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-9 rounded-lg border border-border px-3 text-[13.5px]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            onClick={() => {
              setCurrency(defaultCurrency);
              setAdding(true);
            }}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[13px] text-muted hover:border-brand hover:text-brand"
          >
            <Plus size={13} /> Add an offer
          </button>
        </div>
      )}
    </div>
  );
}
