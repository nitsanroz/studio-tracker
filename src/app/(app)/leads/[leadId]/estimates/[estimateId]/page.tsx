"use client";

// One estimate version — the editor (Leads Phase 4, no AI).
//
// Mirrors the studio's own scope documents (Unibeam, Sep 2026): an intro,
// phases of lines with min–max hours, "choose one" options, optional extras,
// totals "+ VAT", a timeline. Every ₪ figure is CALCULATED (see
// `src/lib/leads/estimate.ts`); there is nowhere to type money.
//
// ⚠️ AN APPROVED VERSION IS READ-ONLY, in the database's actions as well as
// here: Edit (back to draft) or "Save as new version" is how it changes.
//
// The flow is three STEPS (v1.96.0, Nitsan): Draft → Approve → Publish. Asking a
// colleague to review is an OPTION beside Approve, not a step — approving
// straight from a draft is allowed. "Preview as client" draws the client's own
// page from the estimate as it stands, at any step, without publishing.
//
// Two tabs, like a client page: Scope (phases → groups → items, the client's
// sections → groups → tasks — `estimate-scope.tsx`) and Overview (notes, links,
// contacts — `estimate-overview.tsx`), so a won lead converts 1:1.

import { askConfirm, askText } from "@/components/confirm-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  Copy,
  Eye,
  GitBranchPlus,
  LayoutDashboard,
  ListChecks,
  Pencil,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { Tabs } from "@/components/ui";
import { EstimateScope } from "@/components/leads/estimate-scope";
import { EstimateOverview } from "@/components/leads/estimate-overview";
import { NumField, TextField } from "@/components/leads/estimate-fields";
import type { LeadContact } from "@/lib/leads/types";
import { SettingsPopupButton } from "@/components/leads/settings-popup";
import { loadLead, loadVocabulary } from "@/lib/leads/data";
import { updateOffer } from "@/lib/leads/actions";
import { studioToday } from "@/lib/format";
import {
  approveEstimate,
  buildSnapshot,
  deleteEstimate,
  loadEstimate,
  loadLibrary,
  newVersion,
  publishEstimate,
  reopenEstimate,
  unlockEstimate,
  submitForReview,
  updateEstimate,
  type EstimateDetail,
  type PublishedEstimate,
} from "@/lib/leads/estimates-data";
import { fmtHours, fmtNis, totals, type ServiceItem } from "@/lib/leads/estimate";
import { PageSkeleton } from "@/components/skeleton";
import { toast } from "@/lib/toast";
import { StudioArrow } from "@/components/studio-arrow";
import { PublicEstimateView } from "@/app/estimate/[token]/public-estimate-view";

const CARD = "rounded-2xl bg-surface p-5 shadow-card";
const BTN =
  "flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-[13.5px] text-foreground ring-1 ring-inset ring-border transition-colors hover:ring-brand";
const PRIMARY = "flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark";
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-background text-muted" },
  in_review: { label: "In review", cls: "bg-[#fdf3e3] text-[#8a5a09]" },
  approved: { label: "Approved", cls: "bg-[#eaf6ee] text-[#12693d]" },
};

export default function EstimatePage() {
  const isAdmin = useIsAdmin();
  const { currentUserId, profiles } = useData();
  const router = useRouter();
  const { leadId, estimateId } = useParams<{ leadId: string; estimateId: string }>();

  const [detail, setDetail] = useState<EstimateDetail | null>(null);
  const [library, setLibrary] = useState<ServiceItem[]>([]);
  const [company, setCompany] = useState("");
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  const [tab, setTab] = useState<"scope" | "overview">("scope");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublishedEstimate | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, lib, l] = await Promise.all([loadEstimate(estimateId), loadLibrary(), loadLead(leadId)]);
      setDetail(d);
      setLibrary(lib);
      setCompany(l?.lead.company ?? "");
      setContacts(l?.contacts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the estimate.");
    } finally {
      setBusy(false);
    }
  }, [estimateId, leadId]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      if (alive) await reload();
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

  const t = useMemo(
    () => (detail ? totals(detail.lines, detail.estimate.rate, detail.estimate.vatPercent, detail.estimate.discountPercent) : null),
    [detail],
  );

  if (!isAdmin) return <p className="py-16 text-center text-sm text-muted">Estimates are for Nitsan and Michal only.</p>;
  if (busy) return <PageSkeleton />;
  if (!detail || !t) return <p className="py-10 text-sm text-danger">{error ?? "That estimate no longer exists."}</p>;

  const e = detail.estimate;
  const locked = e.status === "approved";
  const approver = e.approvedBy ? profiles.find((p) => p.id === e.approvedBy) : null;
  const activeLib = library.filter((i) => i.active);
  const shareUrl = e.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/estimate/${e.shareToken}` : null;
  // Published = the link carries THIS approval. After Edit → re-approve, the old
  // link still shows the earlier snapshot, so the Publish step is open again.
  const published = Boolean(
    locked && e.shareToken && e.publishedAt && (!e.approvedAt || e.publishedAt >= e.approvedAt),
  );
  const step = !locked ? 0 : published ? 2 : 1;

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("Client link copied");
    } catch {
      await askText("Copy this link:", { initial: shareUrl, action: "Done" });
    }
  };
  const publish = async () => {
    // Every publish is a new link (0053), so a re-publish says so: the link
    // already sent keeps showing the earlier offer.
    if (
      e.shareToken &&
      !(await askConfirm("Publish a new link? The link you already sent keeps showing the earlier offer — send the client the new one.", {
        action: "Publish new link",
      }))
    )
      return;
    void run(async () => {
      const token = await publishEstimate(e.id, company, currentUserId);
      // Publishing IS sending (v1.96.0): the offer goes to Sent with today's
      // date, which starts the "offer waiting" reminder and suggests the
      // "Offer sent" stage — before, someone had to set it by hand.
      await markOfferSent(leadId, e.offerId, currentUserId).catch(() => undefined);
      toast("Published — the client link is ready");
      window.open(`/estimate/${token}`, "_blank", "noopener");
    });
  };
  const unlock = async () => {
    const link = e.shareToken ? " The link you sent keeps showing the approved version; publishing again creates a new link." : "";
    if (await askConfirm(`Edit v${e.version}? It goes back to draft and needs approving again.${link}`, { action: "Edit" }))
      void run(() => unlockEstimate(e.id));
  };

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <Link href={`/leads/${leadId}`} className="inline-flex items-center gap-1.5 self-start text-[13.5px] text-muted hover:text-foreground">
        <ChevronLeft size={16} strokeWidth={1.75} /> {company || "Lead"}
      </Link>

      {/* ── header: what this is, and the quiet tools ── */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title">
              Estimate v{e.version} <span className="text-muted">· {company}</span>
            </h1>
            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
          </div>
          <p className="mt-1 text-[14px] text-muted">
            {fmtHours(t.totalHours)} · {fmtNis(t.net)} + VAT
            {e.changeNote && <span className="bidi-auto"> · What changed: {e.changeNote}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => setPreview(buildSnapshot(detail, company, new Date().toISOString()))}
            title="See the page exactly as the client will — nothing is published"
            className={BTN}
          >
            <Eye size={15} strokeWidth={1.75} /> Preview as client
          </button>
          <SettingsPopupButton which="pricing" label="Settings" onClosed={() => void reload()} />
          <button
            onClick={async () => {
              const note = await askText("What will change in the new version?", { action: "Create version", placeholder: "Optional" });
              if (note === null) return;
              try {
                const id = await newVersion(e.id, note, currentUserId);
                router.push(`/leads/${leadId}/estimates/${id}`);
              } catch (ex) {
                setError(ex instanceof Error ? ex.message : "Could not copy the estimate.");
              }
            }}
            className={BTN}
          >
            <GitBranchPlus size={15} strokeWidth={1.75} /> New version
          </button>
          {e.status !== "approved" && (
            <button
              onClick={async () => {
                if (!(await askConfirm(`Delete estimate v${e.version}?`, { action: "Delete", danger: true }))) return;
                try {
                  await deleteEstimate(e.id);
                  router.push(`/leads/${leadId}`);
                } catch (ex) {
                  setError(ex instanceof Error ? ex.message : "Could not delete.");
                }
              }}
              aria-label="Delete this estimate"
              title="Delete"
              className={`${BTN} w-9 justify-center px-0 text-faint hover:text-danger hover:ring-danger/40`}
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* ── the flow, as steps: Draft → Approve → Publish ── */}
      <section className={`${CARD} flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6`}>
        <ol className="flex min-w-0 flex-1 items-start">
          {[
            { name: "Draft", sub: "Build the scope" },
            { name: "Approve", sub: approver && locked ? `by ${approver.name}` : "Locks this version" },
            { name: "Publish", sub: published && e.publishedAt ? `on ${new Date(e.publishedAt).toLocaleDateString("en-GB")}` : "Send the client a link" },
          ].map((st, i) => {
            const done = i < step || (i === 2 && published);
            const at = i === step && !done;
            return (
              <li key={st.name} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                {i > 0 && (
                  <span
                    aria-hidden
                    className={`absolute top-[17px] h-0.5 rounded-full ${i <= step ? "bg-brand" : "bg-border"}`}
                    style={{ left: "calc(-50% + 24px)", right: "calc(50% + 24px)" }}
                  />
                )}
                <span
                  className={`flex size-9 items-center justify-center rounded-full text-[13px] font-medium ${
                    done ? "bg-brand text-white" : at ? "bg-brand text-white ring-4 ring-brand-soft" : "bg-surface text-muted ring-1 ring-inset ring-border"
                  }`}
                >
                  {done ? <Check size={16} strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={`mt-2 text-[14px] ${at || done ? "font-medium text-foreground" : "text-muted"}`}>{st.name}</span>
                <span className="text-[12px] text-muted">{st.sub}</span>
              </li>
            );
          })}
        </ol>

        {/* What to do at this step — one primary action, the rest beside it. */}
        <div className="flex flex-col gap-2 lg:w-[400px] lg:border-l lg:border-border lg:pl-6">
          {step === 0 && (
            <>
              {e.status === "in_review" && (
                <p className="text-[13.5px] text-[#8a5a09]">Shared with a colleague for review. You can still approve it yourself.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => void run(() => approveEstimate(e.id, currentUserId))} className={PRIMARY}>
                  <Check size={16} strokeWidth={2} /> Approve
                </button>
                {e.status === "draft" ? (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await submitForReview(e.id, currentUserId);
                        toast("Sent to a colleague for review");
                      })
                    }
                    title="Optional — mails the approvers (Settings → Leads) to look it over"
                    className={BTN}
                  >
                    <Send size={15} strokeWidth={1.75} /> Ask a colleague to review
                  </button>
                ) : (
                  <button onClick={() => void run(() => reopenEstimate(e.id))} className={BTN}>
                    <Undo2 size={15} strokeWidth={1.75} /> Back to draft
                  </button>
                )}
              </div>
              <p className="text-[12px] text-faint">Approving locks the version. Review is optional.</p>
            </>
          )}
          {step === 1 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => void publish()} className={PRIMARY}>
                  <StudioArrow size={18} /> {e.shareToken ? "Publish a new link" : "Publish to the client"}
                </button>
                <button onClick={() => void unlock()} className={BTN}>
                  <Pencil size={15} strokeWidth={1.75} /> Edit
                </button>
              </div>
              <p className="text-[12px] text-faint">
                {e.shareToken
                  ? "The link already sent still shows the earlier version."
                  : "Publishing freezes what the client sees and opens it in a new tab."}
              </p>
            </>
          )}
          {step === 2 && shareUrl && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <a href={shareUrl} target="_blank" rel="noreferrer" className={PRIMARY}>
                  <Eye size={16} strokeWidth={1.75} /> View as the client
                </a>
                <button onClick={() => void copyLink()} className={BTN}>
                  <Copy size={15} strokeWidth={1.75} /> Copy link
                </button>
                <button onClick={() => void unlock()} className={BTN}>
                  <Pencil size={15} strokeWidth={1.75} /> Edit
                </button>
              </div>
              <p className="truncate text-[12px] text-faint" title={shareUrl}>
                {shareUrl}
              </p>
            </>
          )}
          {/* Back in draft with a link already out: the client still reads the
              published snapshot, which is exactly when it is worth checking. */}
          {step === 0 && shareUrl && (
            <p className="text-[12px] text-muted">
              The client&apos;s link still shows the last published version ·{" "}
              <a href={shareUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                open it
              </a>
            </p>
          )}
        </div>
      </section>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">{error}</div>}

      <Tabs<"scope" | "overview">
        value={tab}
        onChange={setTab}
        items={[
          { value: "scope", label: "Scope", icon: ListChecks },
          { value: "overview", label: "Overview", icon: LayoutDashboard },
        ]}
      />

      {tab === "overview" ? (
        <EstimateOverview detail={detail} t={t} contacts={contacts} leadId={leadId} run={run} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            {locked && (
              <p className="text-[13px] text-muted">
                Approved versions are locked — press Edit to change this one, or New version to keep it as it is.
              </p>
            )}
            <div className={CARD}>
              <div className="card-title">Intro</div>
              <p className="text-[12px] text-faint">The first thing the client reads</p>
              <TextField
                value={e.intro}
                disabled={locked}
                multiline
                rows={5}
                onCommit={(v) => void run(() => updateEstimate(e.id, { intro: v }))}
                className="mt-2 w-full resize-y text-[15px] leading-relaxed"
              />
            </div>

            <EstimateScope detail={detail} t={t} library={activeLib} locked={locked} run={run} />

            {/* No "Timeline" field any more (Nitsan, 2026-10-12): each section carries its own
                timeframe beside its title on the client page. `lead_estimates.timeline`
                keeps whatever older estimates hold; nothing renders it. */}
            <div className={CARD}>
              <div className="card-title">Closing</div>
              <TextField
                value={e.closing}
                disabled={locked}
                multiline
                rows={3}
                placeholder={locked ? "" : "We'd be happy to go over this together…"}
                onCommit={(v) => void run(() => updateEstimate(e.id, { closing: v }))}
                className="mt-2 w-full resize-y text-[15px] leading-relaxed"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-20">
            <div className={CARD}>
              <div className="text-[13px] text-muted">Total estimate · {fmtHours(t.totalHours)}</div>
              <div className="mt-1 font-serif-accent text-[26px] leading-tight text-brand">{fmtNis(t.net)}</div>
              <div className="text-[13px] text-muted">+ VAT</div>
              <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-border pt-3 text-[14px] tabular-nums">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-right">{fmtNis(t.subtotal)}</dd>
                {(e.discountPercent ?? 0) > 0 && (
                  <>
                    <dt className="text-muted">Discount {e.discountPercent}%</dt>
                    <dd className="text-right text-danger">−{fmtNis(t.discount)}</dd>
                  </>
                )}
                <dt className="text-muted">VAT {e.vatPercent}%</dt>
                <dd className="text-right text-muted">{fmtNis(t.vat)}</dd>
                <dt className="font-medium">Incl. VAT</dt>
                <dd className="text-right font-medium">{fmtNis(t.gross)}</dd>
              </dl>
            </div>
            <div className={CARD}>
              <div className="card-title">Pricing</div>
              <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-y-2 text-[14px]">
                <span className="text-muted">Rate (₪/h)</span>
                <NumField value={e.rate} disabled={locked} onCommit={(v) => void run(() => updateEstimate(e.id, { rate: v ?? 350 }))} className="w-24" />
                <span className="text-muted">VAT %</span>
                <NumField value={e.vatPercent} disabled={locked} onCommit={(v) => void run(() => updateEstimate(e.id, { vatPercent: v ?? 18 }))} className="w-24" />
                <span className="text-muted">Discount %</span>
                <NumField
                  value={e.discountPercent}
                  disabled={locked}
                  onCommit={(v) => void run(() => updateEstimate(e.id, { discountPercent: v && v > 0 ? Math.min(v, 100) : null }))}
                  className="w-24"
                />
              </div>
              <TextField
                value={e.discountNote}
                disabled={locked}
                placeholder={locked ? "" : "Why the discount (internal)"}
                onCommit={(v) => void run(() => updateEstimate(e.id, { discountNote: v }))}
                className="mt-2 w-full text-[13px] text-muted"
              />
              <p className="mt-2 text-[12px] text-faint">No discount by default — only on client request, case by case.</p>
            </div>
          </div>
        </div>
      )}

      {preview && <ClientPreview s={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/**
 * The client's page, drawn from the estimate as it stands, over everything —
 * portalled to <body> so the app canvas's global card rules don't restyle it.
 * Nothing is stored: closing it leaves no link behind.
 */
function ClientPreview({ s, onClose }: { s: PublishedEstimate; onClose: () => void }) {
  useEffect(() => {
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#e9edf4]" role="dialog" aria-label="Preview as the client">
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-foreground px-4 py-2.5 text-[14px] text-white">
        <Eye size={16} strokeWidth={1.75} />
        <span>
          <b className="font-medium">Preview</b> — what the client will see. Nothing is published.
        </span>
        <button onClick={onClose} className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-white/15 px-3 hover:bg-white/25">
          <X size={15} /> Close
        </button>
      </div>
      <PublicEstimateView s={{ ...s, timeline: null }} />
    </div>,
    document.body,
  );
}

/** The estimate's offer → Sent, unless the client already answered it. */
async function markOfferSent(leadId: string, offerId: string | null, actorId: string | null) {
  if (!offerId) return;
  const [vocab, lead] = await Promise.all([loadVocabulary(), loadLead(leadId)]);
  const offer = lead?.offers.find((o) => o.id === offerId);
  if (!lead || !offer || offer.status === "accepted" || offer.status === "declined") return;
  await updateOffer(offerId, leadId, offer.version, { status: "sent", sentAt: studioToday() }, actorId, {
    current: vocab.stages.find((x) => x.id === lead.lead.stageId),
    stages: vocab.stages,
  });
}
