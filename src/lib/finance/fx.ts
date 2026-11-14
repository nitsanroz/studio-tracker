// ── Monthly exchange rates ───────────────────────────────────────────────────
// A foreign-currency expense is converted to ILS at the rate of the month it
// belongs to: the Bank of Israel representative rate on that month's last
// business day (the latest one so far for the current month), made worse by
// FX_MARKUP to stand in for what the bank or card actually charges — its own
// spread plus the transaction fee. Same method as the sheet's "USDILS Rates"
// tab (month-end rate × 1.05). fx_rates stores the OFFICIAL rate; the markup is
// applied here, so changing it never needs a refetch.

export const FX_MARKUP = 0.05;

export type FxCurrency = "USD" | "EUR";

/** Used only when no Bank of Israel rate is stored for that month or any
 * month before it. Already "bad" rates, so they need no markup. */
export const FX_FALLBACK: Record<FxCurrency, number> = { USD: 3.2, EUR: 3.75 };

export interface FxRow {
  year: number;
  month: number;
  usd_ils: number | string | null;
  eur_ils: number | string | null;
}

/** "YYYY-MM" → official rates for that month. */
export type FxTable = Map<string, Partial<Record<FxCurrency, number>>>;

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function buildFxTable(rows: FxRow[]): FxTable {
  const t: FxTable = new Map();
  for (const r of rows) {
    const entry: Partial<Record<FxCurrency, number>> = {};
    if (r.usd_ils != null && Number(r.usd_ils) > 0) entry.USD = Number(r.usd_ils);
    if (r.eur_ils != null && Number(r.eur_ils) > 0) entry.EUR = Number(r.eur_ils);
    t.set(key(r.year, r.month), entry);
  }
  return t;
}

export interface FxQuote {
  /** The rate actually applied (official × (1 + FX_MARKUP), or the fallback). */
  rate: number;
  /** The Bank of Israel rate it came from; null when the fallback was used. */
  official: number | null;
  /** Which month's official rate was used (it can be an earlier month's). */
  from: string | null;
}

/** Rate for one currency in one month. Uses that month's official rate, else
 * the nearest EARLIER month that has one (never a later month: a rate that
 * hadn't happened yet is not a rate anyone paid), else the fixed fallback. */
export function fxQuote(table: FxTable | undefined, currency: string, year: number, month: number): FxQuote {
  const cur = currency as FxCurrency;
  if (table && (cur === "USD" || cur === "EUR")) {
    let y = year;
    let m = month;
    for (let i = 0; i < 36; i++) {
      const official = table.get(key(y, m))?.[cur];
      if (official) return { rate: official * (1 + FX_MARKUP), official, from: key(y, m) };
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
  }
  return { rate: FX_FALLBACK[cur] ?? 1, official: null, from: null };
}

/** Bank of Israel daily series → the last rate of each month, for one year. */
export function monthEndRates(csv: string, year: number): Map<number, number> {
  const out = new Map<number, number>();
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const di = header.indexOf("TIME_PERIOD");
  const vi = header.indexOf("OBS_VALUE");
  if (di < 0 || vi < 0) return out;
  const latest = new Map<number, string>();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[di];
    const value = Number(cols[vi]);
    if (!date?.startsWith(`${year}-`) || !(value > 0)) continue;
    const month = Number(date.slice(5, 7));
    if (!latest.has(month) || date > latest.get(month)!) {
      latest.set(month, date);
      out.set(month, value);
    }
  }
  return out;
}
