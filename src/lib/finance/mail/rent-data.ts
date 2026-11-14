// Filing a Rent bill from the mail into the Rent tab's grid (v1.24.0) —
// server only, with the user's own session (anyone on Expenses).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, updatePreservingLock } from "@/lib/finance/db";
import { isPeriodLocked, type FinanceLock, type FinanceState } from "@/lib/finance/finance";
import { copyToCells, keepBillLink } from "./receipts-data";
import { rentNet, splitBill } from "./rent";
import { DOCS, RECEIPTS } from "./scan";

type Row = Record<string, unknown>;
const canon = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * The bill's amount, split over its months, into its line's cell for each:
 * the cell's row is updated (a plan becomes the actual) or one is added on
 * the 15th, as the grid itself does — gross = net, rent being a flat cost.
 * The total loses its VAT first when it includes it (`withVat`). A month
 * locked on the Rent tab is refused whole, nothing written — or, with
 * `filesOnly`, keeps its amount and just takes the bill's file and number. A
 * final cell in an open month takes the amount and stays final. The
 * receipt is marked added to the first month's row; its files move there and
 * are copied to the second; the invoice number and card go on both.
 *
 * ⚠️ The receipt is CLAIMED first (2026-11-10): open → "added" with no
 * expense_id yet, conditional on it still being open. Two clicks, or two
 * people, used to both pass the route's status check and both write — a month
 * with no cell got two. Only the claim's winner writes; any refusal puts the
 * receipt back as it was. (The plain Add path in the route does the same.)
 */
export async function fileRentBill(
  sb: SupabaseClient,
  receiptId: string,
  b: RentBill,
): Promise<{ error: string; status?: number } | { ok: true; expenseIds: string[] }> {
  const rec = await sb.from(RECEIPTS).select("status, decided_at").eq("id", receiptId).maybeSingle();
  if (rec.error) return { error: rec.error.message };
  const OPEN = ["new", "skipped"];
  const claim = await sb
    .from(RECEIPTS)
    .update({ status: "added", decided_at: new Date().toISOString() })
    .eq("id", receiptId)
    .in("status", OPEN)
    .select("id");
  if (claim.error) return { error: claim.error.message };
  if (!claim.data?.length) return { error: "Already decided.", status: 409 };
  const done = await fileClaimed(sb, receiptId, b);
  if ("error" in done) {
    // Nothing (or only an idempotent amount) was written: back on the list as it was.
    const back = await sb
      .from(RECEIPTS)
      .update({ status: rec.data?.status ?? "new", decided_at: rec.data?.decided_at ?? null })
      .eq("id", receiptId)
      .eq("status", "added")
      .is("expense_id", null);
    return { error: done.error + (back.error ? ` The receipt is still marked added (${back.error.message}) — reopen it by hand.` : "") };
  }
  return done;
}

type RentBill = { line: string; months: string[]; amount: number; withVat?: boolean; filesOnly?: boolean; invoiceNumber?: string; paidWith?: string };

async function fileClaimed(sb: SupabaseClient, receiptId: string, b: RentBill): Promise<{ error: string } | { ok: true; expenseIds: string[] }> {
  const line = canon(b.line);
  const months = [...new Set(b.months)].sort();
  if (!line || !months.length || months.length > 12 || !months.every((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) || (!b.filesOnly && !(b.amount > 0)))
    return { error: "A line, its months and an amount are needed." };
  // A month finalized on the Rent tab, or whose cell is locked, isn't written.
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
  const locks = await fetchAll<Row>(sb, "finance_locks", "scope_year, scope_month, block", (q) => q.in("scope_year", years));
  const lockList: FinanceLock[] = locks.map((l) => ({ scopeYear: Number(l.scope_year), scopeMonth: l.scope_month == null ? null : Number(l.scope_month), block: l.block as FinanceLock["block"] }));
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-31`;
  const rows = (await fetchAll<Row>(sb, "finance_expenses", "id, date, vendor, amount_gross, state, invoice_number, paid_with", (q) => q.eq("category", "rent").gte("date", from).lte("date", to))).filter(
    (r) => canon(String(r.vendor ?? "")) === line,
  );
  const paperwork = { invoice_number: b.invoiceNumber?.trim().slice(0, 80) || null, paid_with: b.paidWith?.trim().slice(0, 80) || null };
  // A finalized month keeps its amount (v1.24.3): the bill's file and number go on its cell.
  if (b.filesOnly) {
    const ids: string[] = [];
    for (const m of months) {
      const cell = rows.find((r) => String(r.date).startsWith(m));
      if (!cell) return { error: `${line} has no cell in ${m} to attach the bill to.` };
      const keep = Object.fromEntries(Object.entries(paperwork).filter(([k, val]) => val && !String(cell[k] ?? "").trim()));
      if (Object.keys(keep).length) await updatePreservingLock(sb, "finance_expenses", String(cell.id), keep, cell.state as FinanceState);
      ids.push(String(cell.id));
    }
    return settle(sb, receiptId, ids, months);
  }
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    // A month finalized on the Rent tab (its lock) keeps its amounts; a final cell in an open month takes the bill (v1.24.4).
    if (isPeriodLocked(lockList, y, mo, "expenses")) return { error: `${m} is locked on the Rent tab — attach the bill instead, or reopen the month there to change its amount.` };
  }
  // The line's own spelling, so the cells land on it ("חשמל " with its space).
  const any = await sb.from("finance_expenses").select("vendor").eq("category", "rent").order("date", { ascending: false }).limit(400);
  const spelled = ((any.data ?? []) as Row[]).map((r) => String(r.vendor ?? "")).find((v) => canon(v) === line) ?? line;
  // The grid holds amounts without VAT.
  const parts = splitBill(rentNet(b.amount, !!b.withVat, months[0]), months.length);
  const ids: string[] = [];
  for (const [i, m] of months.entries()) {
    const v = parts[i];
    const cell = rows.find((r) => String(r.date).startsWith(m));
    // A bill is what was charged: a planned cell becomes the actual.
    if (cell) {
      const keep = Object.fromEntries(Object.entries(paperwork).filter(([k, val]) => val && !String(cell[k] ?? "").trim()));
      if (cell.state === "final") {
        // Stays final (the guard trigger's way round: drop to actual, write, re-lock); the Plan then asks to accept the new total.
        const err = await updatePreservingLock(sb, "finance_expenses", String(cell.id), { amount_gross: v, amount_no_vat: v, ...keep }, "final");
        if (err) return { error: err.message };
      } else {
        let up = await sb.from("finance_expenses").update({ amount_gross: v, amount_no_vat: v, state: "actual", ...keep }).eq("id", String(cell.id));
        if (up.error && /invoice_number|paid_with/.test(up.error.message)) up = await sb.from("finance_expenses").update({ amount_gross: v, amount_no_vat: v }).eq("id", String(cell.id));
        if (up.error) return { error: up.error.message };
      }
      ids.push(String(cell.id));
    } else {
      const row = { date: `${m}-15`, category: "rent", vendor: spelled, description: "", amount_gross: v, amount_no_vat: v, recurrence: "monthly", state: "actual" };
      let ins = await sb.from("finance_expenses").insert({ ...row, ...paperwork }).select("id").single();
      if (ins.error && /invoice_number|paid_with/.test(ins.error.message)) ins = await sb.from("finance_expenses").insert(row).select("id").single();
      if (ins.error) return { error: ins.error.message };
      ids.push(String(ins.data.id));
    }
  }
  return settle(sb, receiptId, ids, months);
}

/** The receipt (already claimed "added") is linked to the first month's cell; its files move there and are copied to the second. */
async function settle(sb: SupabaseClient, receiptId: string, ids: string[], months: string[]): Promise<{ ok: true; expenseIds: string[] }> {
  // The cells are written by now, so a failure here can't be undone by a retry (the claim refuses it);
  // the receipt stays "added", which is true, and an unlinked one is skipped by every reader.
  await sb.from(RECEIPTS).update({ expense_id: ids[0] }).eq("id", receiptId);
  await sb.from(DOCS).update({ expense_id: ids[0] }).eq("receipt_id", receiptId);
  if (ids.length > 1) await copyToCells(sb, receiptId, ids.slice(1).map((id, i) => ({ expenseId: id, month: months[i + 1] }))).catch(() => undefined);
  await keepBillLink(sb, receiptId, ids).catch(() => undefined);
  return { ok: true, expenseIds: ids };
}
