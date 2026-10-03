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
  ArrowRightLeft,
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
  FileText,
  Globe,
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
import { SourceIcon, StageIcon, stageStyle } from "@/lib/leads/look";
import { Avatar, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { isSafeUrl, normalizeUrl } from "@/lib/links";
import { createClient } from "@/lib/supabase/client";
import {
  loadLead,
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
  loadEstimateSources,
  loadEstimates,
  type EstimateSource,
  type EstimateSourcePhase,
  type EstimateSummary,
} from "@/lib/leads/estimates-data";
import { Modal, ModalClose } from "@/components/ui";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";

type Tab = "contacts" | "emails" | "offers" | "estimates" | "activity";

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const LABEL = "text-[12px] font-medium uppercase tracking-wider text-faint";
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
      const r = await loadStoredRate();
      if (alive) setRate(r);
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

  return (
    <div className="mx-auto max-w-[1500px]">
      <Link
        href="/leads"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} strokeWidth={1.75} /> Leads
      </Link>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {l.deletedAt && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
          <Trash2 size={14} strokeWidth={1.75} className="text-faint" />
          <span>This lead was deleted and is hidden from the board. It will be erased for good tonight.</span>
          <button
            onClick={() => void run(() => restoreLead(l.id))}
            className="ml-auto h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"
          >
            Undo
          </button>
        </div>
      )}

      {/* ── header ── */}
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
            className={`bidi-auto w-full max-w-2xl font-serif-accent text-[32px] leading-tight ${QUIET}`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <Globe size={13} strokeWidth={1.75} className="text-faint" />
              <InlineInput
                key={`w${l.website}`}
                value={l.website}
                placeholder="Website"
                onCommit={(v) => void run(() => updateLead(l.id, { website: v }))}
                className="w-48"
              />
              {l.website && isSafeUrl(normalizeUrl(l.website) ?? "") && (
                <a
                  href={normalizeUrl(l.website) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the website"
                  className="text-faint hover:text-brand"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="text-faint">Source</span>
              <IconSelect
                value={l.source ?? ""}
                onChange={(v) => void run(() => updateLead(l.id, { source: (v || null) as LeadSource | null }))}
                ariaLabel="Source"
                className={QUIET}
                options={[
                  { value: "", label: "Not set" },
                  ...SOURCES.map((s) => ({
                    value: s.value,
                    label: s.label,
                    icon: <SourceIcon source={s.value} className="text-faint" />,
                  })),
                ]}
              />
            </label>
            <span className="text-faint">
              Created {formatDate(l.createdAt)}
              {open && stage && ` · ${daysInStage(l, now)}d in ${stage.name}`}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            value={l.ownerId ?? ""}
            onChange={(e) => void run(() => updateLead(l.id, { ownerId: e.target.value || null }))}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px]"
            aria-label="Owner"
          >
            <option value="">Unassigned</option>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <IconSelect
            value={l.stageId ?? ""}
            onChange={(v) => {
              const to = vocab.stages.find((s) => s.id === v);
              if (to) changeStage(to);
            }}
            ariaLabel="Stage"
            placeholder="No stage"
            className="h-9 rounded-lg border px-2.5 text-[13px] font-medium"
            style={stageStyle(stage)}
            options={vocab.stages.map((s) => ({ value: s.id, label: s.name, icon: <StageIcon stage={s} /> }))}
          />
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
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-faint hover:text-danger"
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* ── suggestions (Phase 3, rule-based) ── */}
      {suggestions
        .filter((sg) => sg.toStageId !== l.stageId)
        .map((sg) => {
          const to = vocab.stages.find((x) => x.id === sg.toStageId);
          return (
            <div
              key={sg.id}
              className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#c9d6fb] bg-brand-soft px-3 py-2 text-[13px]"
            >
              <Lightbulb size={15} strokeWidth={1.75} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-brand-dark">Move to {to?.name ?? "?"}?</span>{" "}
                <span className="bidi-auto text-muted">{sg.reason}</span>
              </span>
              <button
                onClick={() => acceptSuggestion(sg.id, sg.toStageId)}
                className="h-7 rounded-md bg-brand px-2.5 text-[12px] font-medium text-white"
              >
                Accept
              </button>
              <button
                onClick={() => void run(() => decideSuggestion(sg.id, "dismissed", currentUserId))}
                className="h-7 rounded-md border border-border bg-surface px-2.5 text-[12px] text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          );
        })}

      {/* ── banners ── */}
      {stalled && stage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#f3dfb8] bg-[#fdf3e3] px-3 py-2 text-[13px] text-[#8a5a09]">
          <AlarmClock size={15} strokeWidth={1.75} />
          Stalled — no activity for {quietWorkDays(l.lastActivityAt, now)} working days, past the {stage.stallDays}-day
          limit for {stage.name}. Log a call or email to clear it.
        </div>
      )}
      {stage?.kind === "won" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#cde8d6] bg-[#eaf6ee] px-3 py-2 text-[13px] text-[#12693d]">
          <Trophy size={15} strokeWidth={1.75} />
          Won{l.wonAt ? ` on ${formatDate(l.wonAt)}` : ""}.
          {l.clientId && (
            <Link href={`/clients/${l.clientId}`} className="font-medium underline">
              {wonClient?.name ?? "Open the client"}
            </Link>
          )}
          {!l.clientId && (
            <button onClick={() => setPending({ from: stage, to: stage })} className="font-medium underline">
              Create the client
            </button>
          )}
        </div>
      )}
      {stage?.kind === "lost" && (
        <div className="mt-4 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-muted">
          Lost{lostReason ? ` — ${lostReason.name}` : ""}
          {l.lostNote && <span className="bidi-auto"> · {l.lostNote}</span>}
        </div>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_360px]">
        {/* ── main: tabs ── */}
        <div className={CARD}>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: "activity", label: "Activity", count: events.length },
              { value: "contacts", label: "Contacts", count: contacts.length },
              { value: "emails", label: "Emails", count: threads.length },
              { value: "offers", label: "Offers", count: offers.length },
              { value: "estimates", label: "Estimates" },
            ]}
            className="mb-4"
          />
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
          {tab === "contacts" && (
            <ContactsTab
              contacts={contacts}
              onAdd={() => run(() => addContact(l.id, { name: "" }, contacts.length + 1))}
              onSave={(c, f) => run(() => updateContact(c.id, l.id, f))}
              onRemove={async (c) => {
                if (await askConfirm(`Remove ${c.name || "this contact"} from this lead?`, { action: "Remove", danger: true }))
                  void run(() => removeContact(c.id, l.id));
              }}
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

        {/* ── side: the deal ── */}
        <div className="flex flex-col gap-3">
          <div className={`${CARD} ${open && !l.nextStep ? "border-warning/60" : ""}`}>
            <div className={LABEL}>Next step</div>
            <textarea
              key={`n${l.nextStep}`}
              defaultValue={l.nextStep ?? ""}
              placeholder={open ? "Every open lead needs one — what happens next?" : "—"}
              rows={2}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== l.nextStep) void run(() => updateLead(l.id, { nextStep: v }));
              }}
              className={`bidi-auto mt-1 w-full resize-y text-[13.5px] ${QUIET} ${open && !l.nextStep ? "placeholder:text-warning" : ""}`}
            />
            <label className="mt-1 flex items-center gap-2 text-[12.5px]">
              <span className="text-faint">Due</span>
              <input
                type="date"
                key={`d${l.nextStepDue}`}
                defaultValue={l.nextStepDue ?? ""}
                onChange={(e) => void run(() => updateLead(l.id, { nextStepDue: e.target.value || null }))}
                className={`${QUIET} ${overdue ? "text-danger" : "text-muted"}`}
              />
              {overdue && <span className="text-[11.5px] text-danger">overdue</span>}
            </label>
          </div>

          <div className={CARD}>
            <div className={LABEL}>The deal</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1000}
                key={`v${l.estValue}`}
                defaultValue={l.estValue ?? ""}
                placeholder="Estimated value"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== l.estValue && (v === null || Number.isFinite(v)))
                    void run(() => updateLead(l.id, { estValue: v }));
                }}
                className={`w-36 text-[15px] font-medium ${QUIET}`}
              />
              <select
                value={l.currency}
                onChange={(e) => void run(() => updateLead(l.id, { currency: e.target.value as Currency }))}
                className={`${QUIET} cursor-pointer text-[13px]`}
                aria-label="Currency"
              >
                <option value="ILS">₪ ILS</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
            {l.currency === "USD" && l.estValue !== null && (
              <p className="mt-1 text-[11.5px] text-faint" title="Bank of Israel rate, 5% worse">
                ≈ {formatIls(valueIls)} at {quote.rate.toFixed(3)}
                {quote.date ? ` (BoI ${formatDate(quote.date)} − 5%)` : " (fallback rate)"}
              </p>
            )}
            <div className={`mt-3 ${LABEL}`}>What they asked for</div>
            <textarea
              key={`a${l.askedFor}`}
              defaultValue={l.askedFor ?? ""}
              placeholder="Brand, website, deck…"
              rows={3}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== l.askedFor) void run(() => updateLead(l.id, { askedFor: v }));
              }}
              className={`bidi-auto mt-1 w-full resize-y text-[13px] text-muted ${QUIET}`}
            />
            {l.sheetRef && <p className="mt-2 text-[11px] text-faint">Imported from the Sheet ({l.sheetRef})</p>}
          </div>
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
        className="flex flex-col gap-2 rounded-lg border border-border p-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border text-[12px]">
            {LOGGABLE.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                aria-pressed={kind === k.value}
                className={`flex items-center gap-1.5 px-2.5 py-1 ${kind === k.value ? "bg-brand-soft font-medium text-brand-dark" : "text-muted"}`}
              >
                {(() => {
                  const Icon = EVENT_ICON[k.value];
                  return <Icon size={13} strokeWidth={1.75} aria-hidden />;
                })()}
                {k.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-faint">
            When
            <input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="rounded border border-border px-1 py-0.5 text-[12px] text-muted"
            />
            {!at && <span>(today)</span>}
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
          rows={2}
          placeholder="What was said, what was agreed…"
          className="bidi-auto w-full resize-y rounded-md border border-border px-2 py-1.5 text-[13px]"
        />
        <div>
          <button
            type="submit"
            disabled={!body.trim() || saving}
            className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Log it"}
          </button>
        </div>
      </form>

      <ol className="mt-4 flex flex-col">
        {events.map((ev) => {
          const who = ev.actorId ? profileById.get(ev.actorId) : null;
          const line = eventLine(ev);
          return (
            <li key={ev.id} className="group flex gap-3 border-b border-border/60 py-2.5 last:border-0">
              <span className="w-16 shrink-0 pt-0.5 text-[11.5px] text-faint">{formatDate(ev.at)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  {(() => {
                    const Icon = EVENT_ICON[ev.kind];
                    return Icon ? <Icon size={13} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden /> : null;
                  })()}
                  <span className="font-medium">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
                  {line && <span className="bidi-auto text-muted">{line}</span>}
                  {who && (
                    <span className="flex items-center gap-1 text-[11.5px] text-faint">
                      · <Avatar profile={who} size={14} /> {who.name}
                    </span>
                  )}
                  {logged.has(ev.kind) && (
                    <button
                      onClick={async () => {
                        if (await askConfirm("Remove this entry?", { action: "Remove", danger: true })) void onRemove(ev.id);
                      }}
                      aria-label="Remove this entry"
                      className="ml-auto text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {ev.body && (
                  <p className="bidi-auto mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                    {ev.body}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {events.length === 0 && <p className="text-[12.5px] text-faint">Nothing logged yet.</p>}
      </ol>
    </div>
  );
}

// ── contacts ────────────────────────────────────────────────────────────────

function ContactsTab({
  contacts,
  onAdd,
  onSave,
  onRemove,
}: {
  contacts: LeadContact[];
  onAdd: () => Promise<void>;
  onSave: (c: LeadContact, f: ContactFields) => Promise<void>;
  onRemove: (c: LeadContact) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {contacts.map((c) => (
        <div key={c.id} className="group rounded-lg border border-border p-3">
          <div className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              <InlineInput
                value={c.name === "Unnamed" ? null : c.name}
                placeholder="Name"
                onCommit={(v) => void onSave(c, { name: v ?? "" })}
                className="bidi-auto text-[14px] font-medium"
              />
              <InlineInput
                value={c.title}
                placeholder="Title"
                onCommit={(v) => void onSave(c, { title: v })}
                className="bidi-auto text-[13px] text-muted"
              />
              <span className="flex items-center gap-1.5">
                <Mail size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                <InlineInput
                  value={c.email}
                  placeholder="Email"
                  type="email"
                  onCommit={(v) => void onSave(c, { email: v })}
                  className="min-w-0 flex-1 text-[13px]"
                />
              </span>
              <span className="flex items-center gap-1.5">
                <Phone size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                <InlineInput
                  value={c.phone}
                  placeholder="Phone"
                  onCommit={(v) => void onSave(c, { phone: v })}
                  className="min-w-0 flex-1 text-[13px]"
                />
              </span>
              <InlineInput
                value={c.linkedin}
                placeholder="LinkedIn"
                onCommit={(v) => void onSave(c, { linkedin: v })}
                className="text-[12.5px] text-muted"
              />
              <InlineInput
                value={c.persona}
                placeholder="Persona"
                onCommit={(v) => void onSave(c, { persona: v })}
                className="bidi-auto text-[12.5px] text-muted"
              />
              <InlineInput
                value={c.pastConnection}
                placeholder="Past connection"
                onCommit={(v) => void onSave(c, { pastConnection: v })}
                className="bidi-auto text-[12.5px] text-muted sm:col-span-2"
              />
            </div>
            <button
              onClick={() => onRemove(c)}
              aria-label={`Remove ${c.name}`}
              className="text-faint opacity-0 hover:text-danger group-hover:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      {contacts.length === 0 && <p className="text-[12.5px] text-faint">No contacts yet.</p>}
      <div>
        <button
          onClick={() => void onAdd()}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={13} /> Add a contact
        </button>
      </div>
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
    <span className="shrink-0 rounded-full bg-[#fdf3e3] px-1.5 py-0.5 text-[10.5px] font-medium text-[#8a5a09]">
      We owe a reply
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10.5px] text-muted">Waiting on them</span>
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
            <span className="bidi-auto min-w-0 truncate text-[13px] font-medium">{t.subject || "(no subject)"}</span>
            <OwedBadge by={t.replyOwedBy} />
          </span>
          {synced && (
            <span className="mt-0.5 block truncate text-[11.5px] text-faint">
              {outside.slice(0, 3).join(", ")}
              {outside.length > 3 ? ` +${outside.length - 3}` : ""} · {t.messageCount} message
              {t.messageCount === 1 ? "" : "s"} · last {ago(t.lastMessageAt)}
              {t.matchedBy && t.matchedBy !== "manual" && ` · matched by ${t.matchedBy}`}
            </span>
          )}
          {t.digest && !open && (
            <span className="bidi-auto mt-0.5 block line-clamp-1 text-[12px] text-muted">{t.digest}</span>
          )}
          {!synced && <span className="mt-0.5 block text-[11.5px] text-faint">Linked by hand · {formatDate(t.createdAt)}</span>}
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
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {!err && messages === null && <p className="text-[12px] text-faint">Loading…</p>}
          {(messages ?? []).map((m) => (
            <div key={m.id} className={`rounded-lg px-3 py-2 ${m.fromUs ? "bg-brand-soft/50" : "bg-background"}`}>
              <div className="mb-1 flex items-baseline gap-2 text-[11.5px]">
                <span className="font-medium text-foreground">{m.fromName || m.fromAddr}</span>
                {m.fromName && <span className="text-faint">{m.fromAddr}</span>}
                <span className="ml-auto shrink-0 text-faint">{m.sentAt ? formatDate(m.sentAt) : ""}</span>
              </div>
              <p className="bidi-auto line-clamp-[12] whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
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
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] hover:border-brand disabled:opacity-50"
        >
          <Search size={13} /> {searching ? "Searching Gmail…" : "Search Gmail"}
        </button>
        <span className="text-[11.5px] text-faint">
          {backfilledAt ? `Searched ${ago(backfilledAt)} · new mail arrives on its own` : "Matches by contact email, then company domain"}
        </span>
        <button onClick={() => setByHand((v) => !v)} className="ml-auto text-[12px] text-muted hover:text-foreground">
          {byHand ? "Cancel" : "Link a thread by hand"}
        </button>
      </div>
      {note && <p className="mb-3 text-[12px] text-muted">{note}</p>}
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
            className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-[12.5px]"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="bidi-auto w-48 rounded-md border border-border px-2 py-1.5 text-[12.5px]"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40"
          >
            Link
          </button>
          {bad && <p className="w-full text-[12px] text-danger">That address could not be read.</p>}
        </form>
      )}
      <ul className="flex flex-col gap-1.5">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} onUnlink={() => void onUnlink(t)} />
        ))}
        {threads.length === 0 && <p className="text-[12.5px] text-faint">No threads yet.</p>}
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
          : await copyEstimate(pick, leadId, company, currentUserId);
      router.push(`/leads/${leadId}/estimates/${id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create the estimate.");
      setBusy(false);
    }
  }

  const option = (value: string, title: React.ReactNode, sub?: string) => (
    <label
      key={value}
      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
        pick === value ? "border-brand bg-brand-soft/40" : "border-border hover:border-brand/50"
      }`}
    >
      <input type="radio" name="est-source" checked={pick === value} onChange={() => setPick(value)} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        {sub && <span className="block truncate text-[11.5px] text-muted">{sub}</span>}
      </span>
    </label>
  );

  return (
    <Modal onClose={onClose} width="lg" align="center" className="max-h-[85vh] overflow-y-auto" labelledBy="new-est-title">
      <div className="mb-3 flex items-center gap-2">
        <h3 id="new-est-title" className="text-sm font-semibold">
          New estimate for {company}
        </h3>
        <span className="ml-auto">
          <ModalClose onClose={onClose} />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {option("blank", <span className="font-medium">Blank</span>, "One empty phase; add lines from the library.")}
        {sources === null && <p className="text-[12.5px] text-faint">Loading estimates…</p>}
        {groups.map((g) =>
          g.rows.length ? (
            <div key={g.title} className="mt-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
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
                            <span className="ml-1.5 text-[11.5px] text-muted">
                              {r.status === "approved" ? "approved" : r.status === "in_review" ? "in review" : "draft"}
                            </span>
                          </span>
                          <span className="block truncate text-[11.5px] text-muted">
                            {r.phases.map((p) => p.name).join(" · ") || "no phases"} · {formatDate(r.createdAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[12px] font-medium tabular-nums">{fmtNis(r.net)}</span>
                          <span className="block text-[11.5px] tabular-nums text-muted">{fmtHours(r.hours)}</span>
                        </span>
                      </span>,
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null,
        )}
        {sources?.length === 0 && (
          <p className="mt-1 text-[12px] text-faint">No other estimates yet — once there are, any of them can be the starting point.</p>
        )}
      </div>
      {pick !== "blank" && (
        <p className="mt-3 text-[11.5px] text-muted">
          Copies every phase, line, option and the texts into a new draft. The other company&rsquo;s name in the texts
          is replaced with {company}; check the greeting.
        </p>
      )}
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      {hover && <EstimateSourceCard src={hover.src} rect={hover.rect} />}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="h-8 rounded-lg border border-border px-3 text-[12.5px]">
          Cancel
        </button>
        <button
          onClick={() => void start()}
          disabled={busy}
          className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : pick === "blank" ? "Start blank" : "Copy and edit"}
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
      {list === null && <p className="text-[12.5px] text-faint">Loading…</p>}
      {(list ?? []).map((e) => (
        <Link
          key={e.id}
          href={`/leads/${leadId}/estimates/${e.id}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2.5 hover:border-brand"
        >
          <span className="text-[13.5px] font-medium">v{e.version}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${EST_STATUS[e.status]}`}>
            {e.status === "in_review" ? "In review" : e.status === "approved" ? "Approved" : "Draft"}
          </span>
          <span className="text-[13px] tabular-nums">
            {fmtHours(e.hours)} · {fmtNis(e.net)} + VAT
          </span>
          {e.changeNote && <span className="bidi-auto min-w-0 truncate text-[12px] text-muted">{e.changeNote}</span>}
          <span className="ml-auto text-[11.5px] text-faint">
            {e.approvedBy ? `approved by ${profileName(e.approvedBy) ?? "?"} · ` : ""}
            {e.shareToken ? "published · " : ""}
            {formatDate(e.createdAt)}
          </span>
        </Link>
      ))}
      {list?.length === 0 && <p className="text-[12.5px] text-faint">No estimate yet.</p>}
      {choosing && (
        <NewEstimateModal leadId={leadId} company={company} clientId={clientId} onClose={() => setChoosing(false)} />
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div>
        <button
          onClick={() => setChoosing(true)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={13} /> New estimate…
        </button>
        {list && list.length > 0 && (
          <p className="mt-1 text-[11.5px] text-faint">Start blank or from any earlier estimate — this client&rsquo;s or another project&rsquo;s.</p>
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

/**
 * Uploads one file to the private `lead-files` bucket and returns its path.
 * The route hands out a signed URL; the bytes go straight to storage, so large
 * decks are not refused by Vercel's body limit (see /api/lead-file).
 */
async function uploadOfferFile(leadId: string, file: File): Promise<{ path: string; name: string }> {
  const res = await fetch("/api/lead-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId, name: file.name, size: file.size }),
  });
  const j = (await res.json().catch(() => ({}))) as { path?: string; token?: string; contentType?: string; error?: string };
  if (!res.ok || !j.path || !j.token) throw new Error(j.error ?? "Could not start the upload.");
  const { error } = await createClient()
    .storage.from("lead-files")
    .uploadToSignedUrl(j.path, j.token, file, { contentType: j.contentType });
  if (error) throw new Error(`Upload failed — ${error.message}`);
  return { path: j.path, name: file.name };
}

const fileHref = (path: string) => `/api/lead-file?p=${encodeURIComponent(path)}`;

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
      const uploaded = file ? await uploadOfferFile(leadId, file) : null;
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
              <span className="text-[13px] font-medium">v{o.version}</span>
              <span className="text-[15px] font-medium">{formatMoney(o.amount, o.currency)}</span>
              {o.currency === "USD" && o.amount !== null && (
                <span className="text-[11.5px] text-faint">≈ {formatIls(o.amount * quoteRate)}</span>
              )}
              <select
                value={o.status}
                onChange={(e) =>
                  void run(() =>
                    updateOffer(o.id, leadId, o.version, { status: e.target.value as OfferStatus }, currentUserId, rules),
                  )
                }
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-[12px]"
                aria-label="Offer status"
              >
                {OFFER_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[12px] text-faint">
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
                  href={fileHref(o.storagePath)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[12px] text-muted hover:text-brand"
                >
                  <FileText size={13} /> {o.fileName ?? "File"}
                </a>
              )}
              <span className="ml-auto flex items-center gap-2">
                {o.approvedAt ? (
                  <span className="flex items-center gap-1 text-[12px] text-[#12693d]">
                    <CheckCircle2 size={13} /> Approved{approver ? ` by ${approver.name}` : ""} ·{" "}
                    {formatDate(o.approvedAt)}
                  </span>
                ) : (
                  <button
                    onClick={() => void run(() => approveOffer(o.id, leadId, o.version, currentUserId))}
                    className="rounded-lg border border-border px-2 py-0.5 text-[12px] hover:border-brand hover:text-brand"
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
              <p className="bidi-auto mt-1.5 whitespace-pre-wrap text-[12.5px] text-muted">{o.scopeSummary}</p>
            )}
          </div>
        );
      })}
      {offers.length === 0 && !adding && <p className="text-[12.5px] text-faint">No offers yet.</p>}

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand-soft/30 p-3"
        >
          <div className="text-[13px] font-medium">New offer · v{nextVersion}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              step={100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              autoFocus
              className="w-36 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
            >
              <option value="ILS">₪ ILS</option>
              <option value="USD">$ USD</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OfferStatus)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
            >
              {OFFER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              Sent
              <input
                type="date"
                value={sentAt}
                onChange={(e) => setSentAt(e.target.value)}
                className="rounded-md border border-border bg-surface px-1.5 py-1 text-[12.5px]"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand">
              <Upload size={12} /> {file ? file.name : "Attach the file"}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={2}
            placeholder="Scope summary — what this version includes"
            className="bidi-auto w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Add offer"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-8 rounded-lg border border-border px-3 text-[12.5px]"
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
            className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
          >
            <Plus size={13} /> Add an offer
          </button>
        </div>
      )}
    </div>
  );
}
