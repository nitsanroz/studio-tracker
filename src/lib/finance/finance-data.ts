"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/finance/supabase-client";
import {
  fetchAll,
  mapClientMonthly,
  mapPnl,
  type ClientMonthlyRow,
  type EventRow,
  type ExpenseRowDb,
  type PnlRow,
} from "@/lib/finance/db";
import { buildFxTable, type FxRow, type FxTable } from "@/lib/finance/fx";
import type { ClientMonthly, PnlMonthly } from "@/lib/finance/finance";

export interface FinanceCore {
  pnl: PnlMonthly[];
  clientMonthly: ClientMonthly[];
  events: EventRow[];
  expenses: ExpenseRowDb[];
  /** Monthly exchange rates — foreign expenses are converted at their month's rate. */
  fx: FxTable;
}

/** Load what the Overview reads. Owner-only via RLS. */
async function loadFinanceCore(): Promise<FinanceCore> {
  const sb = createClient();
  const [pnl, clientMonthly, events, expenses, fxRows] = await Promise.all([
    fetchAll<PnlRow>(sb, "finance_pnl_monthly", "*"),
    fetchAll<ClientMonthlyRow>(
      sb,
      "finance_client_monthly",
      "id, year, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state",
    ),
    fetchAll<EventRow>(sb, "finance_events", "id, year, month, event, category, note"),
    fetchAll<ExpenseRowDb>(
      sb,
      "finance_expenses",
      "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state",
    ),
    // Best-effort: without rates, foreign amounts use their stored snapshot.
    fetchAll<FxRow>(sb, "fx_rates", "*").catch(() => [] as FxRow[]),
  ]);
  return {
    pnl: pnl.map(mapPnl),
    clientMonthly: clientMonthly.map(mapClientMonthly),
    events,
    expenses,
    fx: buildFxTable(fxRows),
  };
}

/**
 * The last core this tab loaded — so a page opened again (Scenarios after
 * &advice, Overview after Plan) draws at once from it and refreshes quietly
 * (Nitsan, 2026-11-16: the switch "takes 1-2 seconds till it appears"). In
 * memory only, for this tab; never stored, and nothing a page didn't already
 * hold.
 */
let lastCore: FinanceCore | null = null;
let lastAt = 0;
/** A core this fresh is used as it is on a remount; a write calls `reload()` itself. */
const FRESH_MS = 60_000;

export function useFinanceCore() {
  const [data, setData] = useState<FinanceCore | null>(lastCore);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(lastCore == null);

  /** `silent` refreshes the figures in place, without the loading screen. */
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const core = await loadFinanceCore();
      lastCore = core;
      lastAt = Date.now();
      setData(core);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load finance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A page opened again starts from the last core; it reloads (silently) only
    // when that core is over a minute old.
    if (lastCore != null && Date.now() - lastAt < FRESH_MS) return;
    void reload(lastCore != null);
  }, [reload]);

  return { data, error, loading, reload };
}
