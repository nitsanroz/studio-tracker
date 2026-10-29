"use client";

// Vacation balance and requests (migration 0058), fetched per surface rather
// than through the store: a handful of rows, and most screens never need them.
//
// ⚠️ WRITES ARE BLOCKED UNDER `?viewAs=`. These calls go straight to Supabase,
// so the store's preview guard can't see them — and the request would be
// written as the signed-in admin, not the member being previewed (the bug
// preview-guard.ts was written for). Reads are fine: the owner previewing a
// member sees that member's balance and requests.
//
// Until 0058 is run every call fails with a missing-schema code, and `ready`
// stays false, so the surfaces simply don't render.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MISSING_SCHEMA_CODES } from "@/lib/db";
import { useData } from "@/lib/store";
import type { VacationBalance, VacationRequest, VacationStatus } from "@/lib/vacation";

interface RequestRow {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  days: number;
  message: string;
  status: VacationStatus;
  /** 0060; absent before it's run. */
  dates?: string[] | null;
  replaces_id?: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}
interface BalanceRow {
  profile_id?: string;
  year: number;
  month: number;
  balance: number | string | null;
  accrued: number | string | null;
}

const mapRequest = (r: RequestRow): VacationRequest => ({
  id: r.id,
  profileId: r.profile_id,
  startDate: r.start_date,
  endDate: r.end_date,
  days: r.days,
  message: r.message,
  status: r.status,
  dates: r.dates ?? null,
  replacesId: r.replaces_id ?? null,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  createdAt: r.created_at,
});
const mapBalance = (r: BalanceRow): VacationBalance => ({
  year: r.year,
  month: r.month,
  balance: Number(r.balance ?? 0),
  accrued: r.accrued == null ? null : Number(r.accrued),
});

const missing = (e: { code?: string } | null) => !!e?.code && MISSING_SCHEMA_CODES.has(e.code);

/** Every surface holds its own copy (the bell, Home, the plan, the page), so a
 * write here tells the others to reload. */
const CHANGED = "vacation:changed";
/** Someone else's request reaches the owner's bell within this, or on return to the tab. */
const POLL_MS = 5 * 60_000;

export interface VacationState {
  /** 0058 is in and the first load finished. */
  ready: boolean;
  /** 0058 hasn't been run: there's no vacation feature yet. */
  unavailable: boolean;
  /** Your own latest payslip line; null with no payslip yet. */
  mine: VacationBalance | null;
  /** The signed-in person — whose balance `mine` is, even under `?viewAs=`. */
  mineProfileId: string | null;
  /** Your requests — or, for an admin, everyone's (RLS decides). */
  requests: VacationRequest[];
  /** You approve requests (the owner). */
  approver: boolean;
  /** Everyone's latest balance by profile — the approver only. */
  balances: Map<string, VacationBalance>;
  /** Set when a write was refused (a preview, or the database said no). */
  error: string | null;
  /** `replacesId`: a change to your approved request, sent back for approval (0060). */
  request: (r: { startDate: string; endDate: string; message: string; replacesId?: string }) => Promise<boolean>;
  /** Change your own request while it's still waiting. */
  edit: (id: string, r: { startDate: string; endDate: string; message: string }) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  decide: (id: string, status: "approved" | "declined", note?: string) => Promise<boolean>;
  reload: () => void;
}

export function useVacation({ enabled = true }: { enabled?: boolean } = {}): VacationState {
  const { viewingAs, refresh, currentUserId } = useData();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [mine, setMine] = useState<VacationBalance | null>(null);
  const [mineProfileId, setMineProfileId] = useState<string | null>(null);
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [approver, setApprover] = useState(false);
  const [balances, setBalances] = useState<Map<string, VacationBalance>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const sb = createClient();
    (async () => {
      const [session, me, reqs, appr] = await Promise.all([
        sb.auth.getSession(),
        sb.rpc("my_vacation"),
        sb.from("vacation_requests").select("*").order("start_date", { ascending: false }),
        sb.rpc("is_vacation_approver"),
      ]);
      if (!live) return;
      if (missing(me.error) || missing(reqs.error) || missing(appr.error)) {
        setUnavailable(true);
        return setReady(false);
      }
      const isApprover = appr.data === true;
      const all = isApprover ? await sb.rpc("vacation_balances") : null;
      if (!live) return;
      const map = new Map(((all?.data as BalanceRow[] | null) ?? []).map((r) => [r.profile_id!, mapBalance(r)]));
      const first = ((me.data as BalanceRow[] | null) ?? [])[0];
      // Previewing a member (`?viewAs=`): show THEIR balance and requests — the
      // owner can see everyone's anyway. Writes stay blocked (see write()).
      // ⚠️ Every value is set in ONE go, after the last await: setting the
      // signed-in balance first and the previewed one after left a reload that
      // was cut off in between showing the owner's own 67 days on Nadav's card.
      const previewing = isApprover && !!viewingAs;
      setMine(previewing ? (map.get(currentUserId) ?? null) : first ? mapBalance(first) : null);
      setMineProfileId(previewing ? currentUserId : (session.data.session?.user.id ?? null));
      setRequests(((reqs.data as RequestRow[] | null) ?? []).map(mapRequest));
      setApprover(isApprover);
      setBalances(map);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [enabled, tick, viewingAs, currentUserId]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener(CHANGED, reload);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, POLL_MS);
    return () => {
      window.removeEventListener(CHANGED, reload);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, reload]);

  const write = useCallback(
    async (run: () => PromiseLike<{ error: { message: string } | null }>, plan = false) => {
      if (viewingAs) {
        setError(`Preview only — you're viewing as ${viewingAs}.`);
        return false;
      }
      setError(null);
      const { error: e } = await run();
      if (e) {
        setError(
          e.message.includes("No workdays")
            ? "Those dates have no workdays."
            : e.message.includes("vacation_requests_one_change_idx")
              ? "A change to this vacation is already waiting for approval."
              : e.message,
        );
        return false;
      }
      window.dispatchEvent(new Event(CHANGED));
      // An approval (or undoing one) adds or clears vacation days in the plan.
      if (plan) refresh();
      return true;
    },
    [viewingAs, refresh],
  );

  const request = useCallback(
    (r: { startDate: string; endDate: string; message: string; replacesId?: string }) =>
      write(() =>
        createClient()
          .from("vacation_requests")
          .insert({
            profile_id: mineProfileId,
            start_date: r.startDate,
            end_date: r.endDate,
            message: r.message.trim(),
            // Only named when set, so a plain request still works before 0060.
            ...(r.replacesId ? { replaces_id: r.replacesId } : {}),
          }),
      ),
    [write, mineProfileId],
  );
  const edit = useCallback(
    (id: string, r: { startDate: string; endDate: string; message: string }) =>
      write(() =>
        createClient()
          .from("vacation_requests")
          .update({ start_date: r.startDate, end_date: r.endDate, message: r.message.trim() })
          .eq("id", id),
      ),
    [write],
  );
  const cancel = useCallback(
    (id: string) =>
      write(() => createClient().from("vacation_requests").update({ status: "cancelled" }).eq("id", id), true),
    [write],
  );
  const decide = useCallback(
    (id: string, status: "approved" | "declined", note?: string) =>
      write(
        () =>
          createClient()
            .from("vacation_requests")
            .update({
              status,
              decided_by: mineProfileId,
              decided_at: new Date().toISOString(),
              decision_note: note?.trim() || null,
            })
            .eq("id", id),
        true,
      ),
    [write, mineProfileId],
  );

  return { ready, unavailable, mine, mineProfileId, requests, approver, balances, error, request, edit, cancel, decide, reload };
}
