/**
 * The share of a month's goal that's "due" by each day: the goal spread evenly
 * over the month's Sun–Thu days, a day counting once it has started. Home's pace
 * chart draws this line and &advice reads its value for today — one copy, so the
 * pane's "93%" and Home's "7% behind goal pace" can't drift apart.
 *
 * ⚠️ In its own file because the pace chart is CLIENT code and `hours-goal.ts`
 * is not: that module carries a freelancer's ₪ rate (HOURLY_TERMS) and the
 * target margin, and a client import of it could ship them to every member's
 * browser. `finance-leak-guard.test.ts` fails if client code imports it.
 */
export function evenSpread(days: string[]): number[] {
  const isWork = days.map((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd).getDay() <= 4;
  });
  const total = isWork.filter(Boolean).length || 1;
  let n = 0;
  return isWork.map((w) => (n += w ? 1 : 0) / total);
}
