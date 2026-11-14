import type { SupabaseClient } from "@supabase/supabase-js";
import { stateOf } from "./finance";
import type {
  ClientMonthly,
  ClientRate,
  ExpenseCategory,
  ExpenseRow,
  FinanceLock,
  FinanceState,
  FreelanceRow,
  IncomeRow,
  IncomeSource,
  PnlMonthly,
  Recurrence,
  SalaryRow,
  Step,
} from "./finance";

/**
 * Minimal structural view of the Postgrest query builder — just the filter
 * methods the finance queries use. Each returns the same shape so calls chain.
 * Avoids depending on Postgrest's version-specific generic signature.
 */
export interface QueryModifier {
  eq(column: string, value: string | number | boolean): QueryModifier;
  neq(column: string, value: string | number | boolean): QueryModifier;
  gte(column: string, value: string | number): QueryModifier;
  lte(column: string, value: string | number): QueryModifier;
  not(column: string, operator: string, value: string | number | null): QueryModifier;
  is(column: string, value: null | boolean): QueryModifier;
  order(column: string, opts?: { ascending?: boolean }): QueryModifier;
  in(column: string, values: readonly (string | number)[]): QueryModifier;
  or(filters: string): QueryModifier;
}

/**
 * Update a row (by id, or a natural-key match), transparently bypassing the finance_guard_locked
 * trigger when needed: it blocks any update that leaves a row `final` on
 * both sides, so a metadata-only change (e.g. a comment) on an already-locked
 * row needs the same two-step drop-to-actual/restore-to-final as a value fix.
 * Returns the first error hit, if any.
 */
export async function updatePreservingLock(
  sb: SupabaseClient,
  table: string,
  where: string | Record<string, string | number>,
  patch: Record<string, unknown>,
  currentState: FinanceState,
): Promise<{ message: string } | null> {
  const match = typeof where === "string" ? { id: where } : where;
  if (currentState !== "final") {
    const { error } = await sb.from(table).update(patch).match(match);
    return error ? { message: error.message } : null;
  }
  const { error: e1 } = await sb.from(table).update({ ...patch, state: "actual" }).match(match);
  if (e1) return { message: e1.message };
  const { error: e2 } = await sb.from(table).update({ state: "final" }).match(match);
  return e2 ? { message: `${e2.message} (re-lock step)` } : null;
}

/**
 * Move a row to a step (finance.ts `Step`): Paid = `final` + `paid_at`; an
 * earlier step clears `paid_at`. Final ↔ paid keeps the row final, which the
 * guard trigger refuses, so it goes through updatePreservingLock; leaving or
 * entering final is one plain update. `extra` rides along on the write (an
 * hours row's fresh revenue as it locks). `paidAt` comes from the caller
 * (finance.ts paidAtOf) so local state is patched with the very value
 * written. The one writer for every step card.
 */
export async function writeStep(
  sb: SupabaseClient,
  table: string,
  where: string | Record<string, string | number>,
  from: FinanceState,
  step: Step,
  paidAt: string | null,
  extra: Record<string, unknown> = {},
): Promise<{ message: string } | null> {
  const state = stateOf(step);
  const patch = { ...extra, paid_at: paidAt };
  if (from === "final" && state === "final") return updatePreservingLock(sb, table, where, patch, "final");
  const { error } = await sb.from(table).update({ ...patch, state }).match(typeof where === "string" ? { id: where } : where);
  return error ? { message: error.message } : null;
}

/**
 * `fetchAll` with one column a migration may not have added yet (e.g.
 * `invoiced_at` before reference/0013 is run): tried with it, and again
 * without it if the database doesn't know it. `has` says which, so the page
 * can hide what needs it instead of failing to load.
 */
export async function fetchAllOptional<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  optional: string,
  modify?: (q: QueryModifier) => QueryModifier,
): Promise<{ rows: T[]; has: boolean }> {
  try {
    return { rows: await fetchAll<T>(sb, table, `${columns}, ${optional}`, modify), has: true };
  } catch (e: unknown) {
    if (!(e instanceof Error && e.message.includes(optional))) throw e;
    return { rows: await fetchAll<T>(sb, table, columns, modify), has: false };
  }
}

/** Supabase caps selects at 1000 rows — page through everything. */
export async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  modify?: (q: QueryModifier) => QueryModifier,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const base = sb.from(table).select(columns).range(from, from + PAGE - 1);
    const q = modify ? modify(base as unknown as QueryModifier) : base;
    const { data, error } = (await (q as unknown as PromiseLike<{
      data: T[] | null;
      error: { message: string } | null;
    }>));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ── Raw row shapes (snake_case, as stored) ───────────────────────────────────
export interface PnlRow {
  year: number;
  month: number;
  line_item: string;
  value: number | string;
  state: FinanceState;
  source: string;
  note?: string | null;
}
export interface ClientMonthlyRow {
  id: string;
  year: number;
  month: number;
  client_id: string | null;
  client_canon: string;
  discipline: string | null;
  sub_account: string | null;
  hours: number | string;
  rate: number | string | null;
  revenue_gross: number | string;
  state: FinanceState;
  comment: string | null;
  paid_at?: string | null;
  invoiced_at?: string | null;
}
export interface ClientRateRow {
  id: string;
  client_id: string | null;
  client_canon: string;
  rate: number | string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
}
export interface ExpenseRowDb {
  id: string;
  date: string;
  end_date: string | null;
  category: ExpenseCategory;
  vendor: string;
  description: string;
  amount_gross: number | string;
  amount_no_vat: number | string | null;
  currency: string;
  vat_included: boolean;
  renew_months: number | null;
  recurrence: Recurrence;
  link: string | null;
  notes: string;
  state: FinanceState;
  /** When its invoice was marked filed (Monthly tab); counts until the next 25th. */
  filed_at?: string | null;
  /** The invoice or receipt number (reference/0018, v1.15.1). */
  invoice_number?: string | null;
  /** What paid it: "Visa ••3562", "Bank transfer" (reference/0018). */
  paid_with?: string | null;
}
export interface SalaryRowDb {
  id: string;
  profile_id: string | null;
  employee_name: string;
  year: number;
  month: number;
  gross_amount: number | string;
  state: FinanceState;
  notes: string;
}
export interface FreelanceRowDb {
  id: string;
  person_name: string;
  role: string;
  year: number;
  month: number;
  amount: number | string;
  rate_note: string;
  state: FinanceState;
  notes: string;
}
export interface IncomeRowDb {
  id: string;
  date: string;
  client_id: string | null;
  source: IncomeSource;
  amount: number | string;
  description: string;
  state: FinanceState;
  comment?: string | null;
  /** the client paid it (reference/0012) — absent before 0012 */
  paid_at?: string | null;
  /** the invoice went out (reference/0013) — absent before 0013 */
  invoiced_at?: string | null;
}
export interface LockRow {
  id: string;
  scope_year: number;
  scope_month: number | null;
  block: FinanceLock["block"];
  locked_at: string;
  note: string | null;
}
export interface EventRow {
  id: string;
  year: number;
  month: number | null;
  event: string;
  category: string | null;
  note: string | null;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

// ── Mappers to the finance.ts calc interfaces ────────────────────────────────
export const mapPnl = (r: PnlRow): PnlMonthly => ({
  year: r.year,
  month: r.month,
  lineItem: r.line_item,
  value: num(r.value),
  state: r.state,
  source: r.source,
  ...(r.note ? { note: r.note } : {}),
});

export const mapClientMonthly = (r: ClientMonthlyRow): ClientMonthly => ({
  year: r.year,
  month: r.month,
  clientId: r.client_id,
  clientCanon: r.client_canon,
  discipline: r.discipline,
  subAccount: r.sub_account ?? "",
  hours: num(r.hours),
  rate: r.rate == null ? null : num(r.rate),
  revenueGross: num(r.revenue_gross),
  state: r.state,
  comment: r.comment ?? "",
  paidAt: r.paid_at ?? null,
  invoicedAt: r.invoiced_at ?? null,
});

export const mapClientRate = (r: ClientRateRow): ClientRate => ({
  clientId: r.client_id,
  clientCanon: r.client_canon,
  rate: num(r.rate),
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
});

export const mapLock = (r: LockRow): FinanceLock => ({
  scopeYear: r.scope_year,
  scopeMonth: r.scope_month,
  block: r.block,
});

export const mapExpense = (r: ExpenseRowDb): ExpenseRow => ({
  date: r.date,
  endDate: r.end_date,
  category: r.category,
  vendor: r.vendor,
  amountGross: num(r.amount_gross),
  amountNoVat: r.amount_no_vat == null ? null : num(r.amount_no_vat),
  state: r.state,
  currency: r.currency,
  vatIncluded: r.vat_included,
  renewMonths: r.renew_months,
  description: r.description,
});

export const mapSalary = (r: SalaryRowDb): SalaryRow => ({
  year: r.year,
  month: r.month,
  grossAmount: num(r.gross_amount),
  state: r.state,
});

export const mapFreelance = (r: FreelanceRowDb): FreelanceRow => ({
  year: r.year,
  month: r.month,
  amount: num(r.amount),
  state: r.state,
});

export const mapIncome = (r: IncomeRowDb): IncomeRow => ({
  date: r.date,
  source: r.source,
  amount: num(r.amount),
  state: r.state,
});
