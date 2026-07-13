export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHoursShort(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Israeli work week: Sunday is the first day. */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 5 || day === 6; // Friday, Saturday
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatDayLabel(d: Date): { name: string; date: string } {
  return {
    name: DAY_NAMES[d.getDay()],
    date: `${d.getDate()}/${d.getMonth() + 1}`,
  };
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}/${m}/${String(y).slice(2)}`;
}

export const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "1.5" / "1.5h" / "90m" / "1:30" → minutes (bare numbers are hours). */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const colon = s.match(/^(\d+):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const minutes = s.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/);
  if (minutes) return Math.round(Number(minutes[1]));
  const hours = s.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (hours) return Math.round(Number(hours[1]) * 60);
  return null;
}

/** "6 Jun Sat" */
export function formatFeedDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${MONTH_NAMES_SHORT[m - 1]} ${DAY_NAMES[dt.getDay()].slice(0, 3)}`;
}

// ── Money & percentages (Finance) ────────────────────────────────────────────
/** Full shekel amount, no decimals: "₪2,849,615". */
export function formatILS(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₪${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
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
