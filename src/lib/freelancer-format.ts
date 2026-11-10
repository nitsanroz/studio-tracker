import { MONTH_NAMES_LONG, MONTH_NAMES_SHORT } from "./format";

// How a freelancer's money, hours and months are written — on the admin's
// /freelancers pages AND on the freelancer's own /log page, which had
// byte-identical copies of all of these (2026-11-10). Pure; client-safe.

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", ILS: "₪" };

/** "€1,250.00" — the currency's symbol, else its code. */
export const money = (n: number, c: string) =>
  `${SYMBOL[c] ?? `${c} `}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "42.5h" */
export const hrs = (n: number) => `${Number(n.toFixed(2)).toLocaleString("en-US")}h`;

/** "Mon 3 Nov" */
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "2026-11" → "November 2026" */
export const monthLabel = (p: string) => `${MONTH_NAMES_LONG[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

/** "2026-11" → "Nov 26" */
export const shortMonth = (p: string) => `${MONTH_NAMES_SHORT[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;

/** "2026-11" moved by `by` months → "2027-01" */
export const shiftMonth = (p: string, by: number) => {
  const i = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
