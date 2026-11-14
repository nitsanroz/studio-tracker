// ── Money & percentages (Finance) ────────────────────────────────────────────
/** Full shekel amount, up to 2 decimals only when present: "₪2,849,615", "₪1,296,451.46". */
export function formatILS(n: number): string {
  const sign = n < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  return `${sign}₪${rounded.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Compact shekels for chart/KPI labels: "₪2.85M", "₪959K", "₪0". */
export function formatILSShort(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}₪${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}₪${Math.round(a / 1_000)}K`;
  return `${sign}₪${Math.round(a)}`;
}

/** Fraction → percent string. formatPct(0.096) → "9.6%". */
export function formatPct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Signed percent for deltas. formatSignedPct(0.123) → "+12.3%". null → "—". */
export function formatSignedPct(fraction: number | null, digits = 1): string {
  if (fraction == null) return "—";
  const s = (fraction * 100).toFixed(digits);
  return `${fraction >= 0 ? "+" : ""}${s}%`;
}

/** Plain number with thousands separators, no currency: "1,234". */
export function formatNum(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A year as its last two digits, "'26" — for tight chart axes. */
export function formatShortYear(year: number | string): string {
  return `'${String(year).slice(2)}`;
}

/** Hours, up to 2 decimals, trailing zeros trimmed: "600", "39.5", "46.75". */
export function formatHours(n: number): string {
  return Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ── Dates ───────────────────────────────────────────────────────────────────
/** The studio's date (Asia/Jerusalem) as "yyyy-mm-dd" — right on the server
 * (UTC) and in any browser. `toISOString()` is UTC: from midnight to 02:00–03:00
 * Tel Aviv time it still says yesterday. */
export function studioToday(at = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/**
 * The studio's date of a stored timestamp (`paid_at`, `invoiced_at`,
 * `decided_at`…): "2026-11-09T22:30:00Z" is 10 Nov in Tel Aviv, while
 * `.slice(0, 10)` says the 9th. A plain "yyyy-mm-dd" comes back as it is.
 */
export function studioDay(ts: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : studioToday(d);
}

/**
 * The studio's current year, read when called — never fix it at module load
 * (`const CUR_YEAR = new Date().getFullYear()`): a tab left open over New Year
 * would keep last year editable (the v1.23.3 auto-rollup bug's shape).
 */
export function studioYear(at = new Date()): number {
  return Number(studioToday(at).slice(0, 4));
}

/** A local date as "yyyy-mm-dd". */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "yyyy-mm-dd" → "21 Oct". */
export function formatShortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
