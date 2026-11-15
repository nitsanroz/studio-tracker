// &advice's ONE engine (finance merge, stage 4 — it was two: the tracker's and
// finance's, each seeing half the studio). One check loads the studio side
// (load.ts) and the money side (lib/finance/advice/load.ts), runs both sets of
// rules plus the ones that read both (cross.ts), and brings ONE store —
// `finance_advice_items` — in line with what they found.
//
// ⚠️ SERVER ONLY, THE OWNER'S OWN SESSION (owner.ts checks first). Never the
// service key: the rows hold amounts, and the store's policy is
// `is_finance_owner()`. Called on every pane open (the live refresh); the day's
// first open also asks Claude for wording (word.ts). There is no cron step any
// more — the leads digest used to run this with the service key.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOk, fetchAll } from "@/lib/db";
import { studioToday } from "@/lib/format";
import { ITEMS, MAIL_EVERY_MS, lastReview, lastWordingRun, loadAdviceData as loadMoneyData, type ReviewState } from "@/lib/finance/advice/load";
import { findAll as findMoney, pulse as moneyPulse } from "@/lib/finance/advice/signals";
import { mailConfigured } from "@/lib/finance/mail/google";
import { mailAccounts } from "@/lib/finance/mail/scan";
import { clientMargin, debtPace, freelancerMargin, oneCardEach, unbilledWork, withMoney } from "./cross";
import { loadCrossFreelancers, loadPeopleCost } from "./cross-load";
import { loadAdviceData as loadStudioData } from "./load";
import { applyPlan, mapAdviceRow, mergeFindings, toDb, visible, type AdviceRow, type Finding } from "./merge";
import { findAll as findStudio, pulse as studioPulse } from "./signals";

type Row = Record<string, unknown>;

/**
 * Studio rules the money side says better — the same finding with its amount
 * (finance wrote them as the tracker's rules "with the money"). One card, not
 * two: "income" is the P&L ratio, which finance's loss and year cards replace.
 */
export const SUPERSEDED = new Set(["pace", "unpaid", "concentration", "client-quiet", "income"]);

/** One figure in the pane, whichever side counted it. */
export interface PaneTile {
  label: string;
  /** what it shows, formatted ("93%", "₪42K") — null when there is nothing */
  display: string | null;
  /** points up or down against what it's compared with, for a percentage */
  delta: number | null;
  /** oldest first — the sparkline */
  series: number[];
  good: boolean;
  note: string;
  help: string;
  /** which pages show it (context.ts); the money side's are prefixed "fin:" */
  scope: string;
  clientId: string | null;
}

export interface AdviceView {
  today: string;
  items: AdviceRow[];
  pulse: PaneTile[];
  /** how many are snoozed or done right now, for the footer */
  hidden: number;
  /** null when Claude wording is on; otherwise why not, in a few words */
  wordingOff: string | null;
  /** today's wording hasn't run yet: the pane asks for it in the background */
  wordingDue: boolean;
  /** the tools review (lib/finance/advice/review.ts): whether it can run, and the last one */
  reviewOn: boolean;
  review: ReviewState | null;
  /** a connected mailbox hasn't been read for a while: the pane asks for it in the background */
  mailDue: boolean;
  /** connected mailboxes — null before the mail tables exist */
  mailboxes: number | null;
  /** when this check ran (ISO) — the pane's "Checked 14:32" */
  checkedAt: string;
  /** when Claude last worded the items (ISO); null when wording is off or failed */
  wordedAt: string | null;
}

export async function loadRows(sb: SupabaseClient): Promise<AdviceRow[]> {
  return (await fetchAll<Row>(sb, ITEMS, "*")).map(mapAdviceRow);
}

/** Is the billing mail due a read? Cheap — the peek asks on every page. */
export async function mailState(sb: SupabaseClient): Promise<{ due: boolean; boxes: number | null }> {
  const mail = await mailAccounts(sb).catch(() => null);
  const live = mail?.filter((a) => a.status !== "revoked") ?? null;
  return {
    due: mailConfigured() && !!live?.some((a) => !a.lastScanAt || Date.now() - new Date(a.lastScanAt).getTime() > MAIL_EVERY_MS),
    boxes: live ? live.length : null,
  };
}

/**
 * When this server instance last ran a check. The corner button's peek reads
 * the stored rows while that was under twenty minutes ago and runs a check
 * otherwise — there is no cron to keep the rows current, and `last_seen` can't
 * say (a check that finds nothing changed writes nothing). A cold instance
 * simply checks: that is what finance's peek did every time.
 */
let lastCheckMs = 0;
const PEEK_FRESH_MS = 20 * 60_000;
export const checkedRecently = () => Date.now() - lastCheckMs < PEEK_FRESH_MS;

/** Run every rule and write the result: the pane's view, plus every stored row for the wording run. */
export async function runCheck(sb: SupabaseClient): Promise<{ view: AdviceView; rows: AdviceRow[] }> {
  const today = studioToday();
  const now = new Date().toISOString();
  const wordingOn = !!process.env.ANTHROPIC_API_KEY;
  // ⚠️ Both sides or neither: a side that failed to load would read as "none of
  // its findings are true any more" and resolve them all, snoozes included.
  const [studio, money, stored, run, review, mail] = await Promise.all([
    loadStudioData(sb, today),
    loadMoneyData(sb, today),
    loadRows(sb),
    wordingOn ? lastWordingRun(sb, today) : null,
    lastReview(sb),
    mailState(sb),
  ]);
  const [freelancers, peopleCost] = await Promise.all([loadCrossFreelancers(sb, studio), loadPeopleCost(sb, today)]);

  const studioAll = findStudio(studio);
  const studioFound: Finding[] = studioAll.filter((f) => !SUPERSEDED.has(f.signal));
  const moneyFound: Finding[] = findMoney(money);
  const findings: Finding[] = oneCardEach([
    ...withMoney(studioFound, money),
    ...moneyFound,
    ...freelancerMargin(studio, money, freelancers),
    ...debtPace(studio, money),
    ...unbilledWork(studio, money),
    ...clientMargin(studio, money, freelancers, peopleCost),
  ]);
  const plan = mergeFindings(stored, findings, now);

  // Inserts come back with their ids; updates and resolves run side by side.
  const [inserted] = await Promise.all([
    plan.insert.length
      ? sb
          .from(ITEMS)
          // An upsert, not an insert: the corner button's peek and an opening pane
          // can run the same check at once, and the second would trip the unique
          // key (seen 2026-11-14 — the peek answered 500).
          .upsert(plan.insert.map(toDb), { onConflict: "key" })
          .select("*")
          .then((res) => {
            assertOk(ITEMS, res);
            return (res.data ?? []).map(mapAdviceRow);
          })
      : [],
    ...plan.update.map((u) =>
      sb
        .from(ITEMS)
        .update(toDb(u.patch))
        .eq("id", u.id)
        .then((res) => assertOk(ITEMS, res)),
    ),
    plan.resolve.length
      ? sb
          .from(ITEMS)
          .update({ resolved_at: now })
          .in("id", plan.resolve)
          .then((res) => assertOk(ITEMS, res))
      : null,
  ]);

  lastCheckMs = Date.now();
  const fresh = applyPlan(stored, plan, inserted, now);
  const shown = visible(fresh, today);
  const tiles: PaneTile[] = [
    ...studioPulse(studio, studioAll).map((p) => ({
      label: p.label,
      display: p.value == null ? null : `${p.value}${p.unit}`,
      delta: p.value != null && p.against != null && p.unit === "%" ? p.value - p.against : null,
      series: p.series,
      good: p.good,
      note: p.note,
      help: p.help,
      scope: p.scope as string,
      clientId: p.clientId,
    })),
    ...moneyPulse(money, moneyFound as Parameters<typeof moneyPulse>[1]).map((p) => ({
      label: p.label,
      display: p.display,
      delta: null,
      series: p.series,
      good: p.good,
      note: p.note,
      help: p.help,
      scope: `fin:${p.scope}`,
      clientId: null,
    })),
  ];
  return {
    rows: fresh,
    view: {
      today,
      items: shown,
      pulse: tiles,
      hidden: fresh.filter((r) => !r.resolvedAt).length - shown.length,
      wordingOff: !wordingOn ? "Plain wording — no Claude API key" : run?.error ? "Plain wording — the last Claude run failed" : null,
      wordingDue: wordingOn && !run?.today,
      reviewOn: wordingOn,
      review,
      mailDue: mail.due,
      mailboxes: mail.boxes,
      checkedAt: now,
      wordedAt: wordingOn && run && !run.error ? run.at : null,
    },
  };
}

/** What the pane shows, after a fresh check. */
export async function checkNow(sb: SupabaseClient): Promise<AdviceView> {
  return (await runCheck(sb)).view;
}
