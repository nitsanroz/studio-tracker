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

export function useFinanceCore() {
  const [data, setData] = useState<FinanceCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** `silent` refreshes the figures in place, without the loading screen. */
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setData(await loadFinanceCore());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load finance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
