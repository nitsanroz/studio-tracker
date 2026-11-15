// What the Salaries and Freelancers pages' side panel shows beside the grid
// (Nitsan, 2026-11-15: "the pages that are mostly a table can get charts at the
// side, of trends and of things worth noticing"): the year month by month
// against last year, the last years side by side, who the money goes to, and
// what moved most.
//
// ⚠️ PURE — no clock, no database. The page hands it the rows it already
// loaded for the year plus the earlier years' rows (components/finance/
// trends-panel.tsx), and which month the comparison runs through.

export interface AmountRow {
  year: number;
  month: number;
  name: string;
  amount: number;
  /** a forecast, not yet a real figure */
  predicted?: boolean;
}

export interface TrendMonth {
  month: number;
  amount: number;
  /** the same month a year earlier; null when that year has no rows at all */
  lastYear: number | null;
  /** every amount in it is a forecast */
  predicted: boolean;
}

export interface Mover {
  name: string;
  /** this year minus last year, over the compared months */
  change: number;
  kind: "up" | "down" | "new" | "gone";
}

export interface Trends {
  year: number;
  /** the comparison covers months 1..through */
  through: number;
  months: TrendMonth[];
  soFar: number;
  lastYearSoFar: number | null;
  /** soFar against lastYearSoFar, as a fraction; null when there is nothing to compare with */
  change: number | null;
  /** a month's average over the compared months that hold anything */
  average: number;
  peak: { month: number; amount: number } | null;
  /** the last years, oldest first, this one last */
  years: { year: number; amount: number; partial: boolean }[];
  /** the largest, by this year's total */
  people: { name: string; amount: number; share: number }[];
  others: { count: number; amount: number; share: number };
  /** how many names were paid over the compared months */
  headcount: { now: number; lastYear: number | null };
  movers: Mover[];
}

const PEOPLE_SHOWN = 5;
const MOVERS_SHOWN = 4;
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/**
 * `rows` = every row of the table for `year` and any earlier years on hand.
 * `through` = the last month the comparison includes (the current month for
 * this year, 12 for a year that is over).
 */
export function trendsOf(rows: AmountRow[], year: number, through: number): Trends {
  const last = through < 1 ? 1 : through > 12 ? 12 : Math.round(through);
  const now = rows.filter((r) => r.year === year);
  const before = rows.filter((r) => r.year === year - 1);
  const hasBefore = before.length > 0;

  const months: TrendMonth[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const mine = now.filter((r) => r.month === m);
    return {
      month: m,
      amount: sum(mine.map((r) => r.amount)),
      lastYear: hasBefore ? sum(before.filter((r) => r.month === m).map((r) => r.amount)) : null,
      predicted: mine.length > 0 && mine.every((r) => r.predicted),
    };
  });

  const compared = months.filter((m) => m.month <= last);
  const soFar = sum(compared.map((m) => m.amount));
  const lastYearSoFar = hasBefore ? sum(compared.map((m) => m.lastYear ?? 0)) : null;
  const filled = compared.filter((m) => m.amount > 0);
  const peak = filled.reduce<TrendMonth | null>((best, m) => (!best || m.amount > best.amount ? m : best), null);

  const yearsOnHand = [...new Set(rows.map((r) => r.year))].filter((y) => y <= year).sort((a, b) => a - b);
  const years = yearsOnHand.map((y) => ({
    year: y,
    amount: y === year ? soFar : sum(rows.filter((r) => r.year === y).map((r) => r.amount)),
    partial: y === year && last < 12,
  }));

  const byName = (list: AmountRow[]) => {
    const out = new Map<string, number>();
    for (const r of list) if (r.month <= last) out.set(r.name, (out.get(r.name) ?? 0) + r.amount);
    return out;
  };
  const mine = byName(now);
  const theirs = byName(before);
  const ranked = [...mine].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const share = (a: number) => (soFar > 0 ? a / soFar : 0);
  const rest = ranked.slice(PEOPLE_SHOWN);
  const restAmount = sum(rest.map(([, a]) => a));

  const movers: Mover[] = [];
  if (hasBefore) {
    for (const name of new Set([...mine.keys(), ...theirs.keys()])) {
      const a = mine.get(name) ?? 0;
      const b = theirs.get(name) ?? 0;
      if (a === b) continue;
      movers.push({ name, change: a - b, kind: b === 0 ? "new" : a === 0 ? "gone" : a > b ? "up" : "down" });
    }
    movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.name.localeCompare(b.name));
  }

  return {
    year,
    through: last,
    months,
    soFar,
    lastYearSoFar,
    change: lastYearSoFar != null && lastYearSoFar > 0 ? (soFar - lastYearSoFar) / lastYearSoFar : null,
    average: filled.length ? soFar / filled.length : 0,
    peak: peak ? { month: peak.month, amount: peak.amount } : null,
    years,
    people: ranked.slice(0, PEOPLE_SHOWN).map(([name, amount]) => ({ name, amount, share: share(amount) })),
    others: { count: rest.length, amount: restAmount, share: share(restAmount) },
    headcount: { now: ranked.length, lastYear: hasBefore ? [...theirs].filter(([, a]) => a > 0).length : null },
    movers: movers.slice(0, MOVERS_SHOWN),
  };
}
