/**
 * The SHAPE of the accountant's yearly figures, and the sums over them — no
 * figures here. The figures themselves are in accountant-years.ts, which only
 * server code may import (finance-leak-guard.test.ts): they reach the browser
 * as props from `(full)/layout.tsx`, after the viewer's tier has been checked,
 * and are read with `useCompanyFigures()`.
 */
export interface AccountantYear {
  year: number;
  revenue: number;
  /** General and administrative expenses (his "הוצאות הנהלה וכלליות"). */
  expenses: number;
  operatingProfit: number;
  /** Before income tax: operating profit, net financing, other income. */
  pretaxProfit: number;
  /** Net profit for the year, after income tax. */
  netProfit: number;
  /** Cash and cash equivalents at 31 December. */
  cash: number;
  /** Retained earnings at 31 December (after any dividend). */
  retained: number;
}

/** Pre-tax margin — the figure that sits beside our P&L margin (profit ÷ revenue). */
export const accountantMargin = (a: AccountantYear): number =>
  a.revenue > 0 ? a.pretaxProfit / a.revenue : 0;

export const accountantByYear = (years: AccountantYear[]): Map<number, AccountantYear> =>
  new Map(years.map((a) => [a.year, a]));
