// Dollars into shekels, for pipeline totals.
//
// The same method finance-admin uses (its `src/lib/fx.ts`): the Bank of Israel
// representative rate, made deliberately worse by FX_MARKUP to stand in for
// what the bank actually does with the money.
//
// ⚠️⚠️ WORSE MEANS FEWER SHEKELS HERE, SO THE MARKUP IS SUBTRACTED. Finance
// converts EXPENSES, where the bad rate is the higher one (official × 1.05 —
// you pay more). A lead is INCOME: a $10,000 deal lands as fewer shekels than
// the official rate promises, so the pipeline counts it at official × 0.95.
// Copying finance's `1 + FX_MARKUP` here would overstate every dollar deal by
// ten points against the honest figure.
//
// ⚠️ ONLY THE OFFICIAL RATE IS STORED (`lead_settings.fx_usd_ils`), never the
// marked-down one, so changing the markup never needs a refetch — finance's
// rule too.

import type { Currency } from "./types";

export const FX_MARKUP = 0.05;

/**
 * Used only when no Bank of Israel rate has ever been stored. Already a "bad"
 * rate, so the markup is not applied to it again — finance's convention.
 *
 * ⚠️ NOT FINANCE'S 3.2. That one is deliberately HIGH because finance converts
 * expenses; for income "bad" is LOW. On 2026-10-02 the bank's rate was 3.06,
 * so 3.2 would have counted every dollar deal above what it is worth. 2.9 is
 * roughly that day's rate less the 5%.
 */
export const FX_FALLBACK_USD = 2.9;

export interface StoredRate {
  /** The Bank of Israel USD→ILS representative rate. */
  official: number;
  /** The date that rate is for, yyyy-mm-dd. */
  date: string;
  /**
   * When we last ASKED the bank, ISO. Staleness is measured from this, not from
   * `date` — over a weekend the newest rate is Thursday's, and measuring from
   * that would ask the bank again on every page load until Sunday.
   */
  checkedAt?: string;
}

export interface FxQuote {
  /** The rate actually applied. */
  rate: number;
  official: number | null;
  date: string | null;
}

export function usdQuote(stored: StoredRate | null): FxQuote {
  if (stored && stored.official > 0) {
    return { rate: stored.official * (1 - FX_MARKUP), official: stored.official, date: stored.date };
  }
  return { rate: FX_FALLBACK_USD, official: null, date: null };
}

/** An amount in shekels, converting dollars at `quote`. Null stays null. */
export function toIls(amount: number | null, currency: Currency, quote: FxQuote): number | null {
  if (amount === null) return null;
  return currency === "USD" ? amount * quote.rate : amount;
}

/** Was the bank last asked more than half a day ago? */
export function isStale(stored: StoredRate | null, now: Date): boolean {
  if (!stored) return true;
  const then = new Date(stored.checkedAt ?? `${stored.date}T00:00:00`);
  if (Number.isNaN(then.getTime())) return true;
  return now.getTime() - then.getTime() > 12 * 3_600_000;
}

/** The Bank of Israel daily series → the most recent date and rate in it. */
export function latestRate(csv: string): StoredRate | null {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const di = header.indexOf("TIME_PERIOD");
  const vi = header.indexOf("OBS_VALUE");
  if (di < 0 || vi < 0) return null;
  let best: StoredRate | null = null;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[di];
    const value = Number(cols[vi]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(value > 0)) continue;
    if (!best || date > best.date) best = { official: value, date };
  }
  return best;
}

export const BOI_USD_URL = (from: string, to: string) =>
  `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startperiod=${from}&endperiod=${to}&format=csv`;

const ILS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "₪48,000" — whole shekels; a pipeline figure is an estimate, not an invoice. */
export function formatIls(amount: number | null): string {
  return amount === null ? "—" : `₪${ILS.format(Math.round(amount))}`;
}

export function formatMoney(amount: number | null, currency: Currency): string {
  if (amount === null) return "—";
  return currency === "USD" ? `$${ILS.format(Math.round(amount))}` : formatIls(amount);
}
