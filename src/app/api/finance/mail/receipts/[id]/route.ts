import { NextResponse, type NextRequest } from "next/server";
import { expensesUser } from "@/lib/finance/advice/owner";
import { amountFieldsOf } from "@/lib/finance/amount-vat";
import { fetchAll } from "@/lib/finance/db";
import { buildFxTable, type FxRow } from "@/lib/finance/fx";
import { fileRentBill } from "@/lib/finance/mail/rent-data";
import { DOCS, IGNORED, RECEIPTS } from "@/lib/finance/mail/scan";

/**
 * One receipt from the mail (v1.14.0), for anyone on Expenses (v1.18.0, reference/0022):
 * - `add` — becomes an expense row as it was set in the list (vendor,
 *   description, category, day, amount, VAT), the Expenses page's own fields;
 * - `rent` — a Rent tab bill, into its line's cell(s) (v1.24.0, `fileRentBill`);
 * - `dismiss` — not an expense;
 * - `ignore` — never suggest this sender's site again (and drop its waiting ones).
 */
type Body =
  | {
      action: "add";
      vendor: string;
      description: string;
      category: "monthly" | "yearly" | "misc" | "investment";
      date: string;
      amount: number;
      currency: string;
      withVat: boolean;
      renewMonths?: number;
      invoiceNumber?: string;
      paidWith?: string;
    }
  | {
      // A Rent tab bill (v1.24.0): its line's cell for each month it covers.
      action: "rent";
      line: string;
      months: string[];
      amount: number;
      withVat?: boolean;
      filesOnly?: boolean;
      invoiceNumber?: string;
      paidWith?: string;
    }
  | { action: "dismiss" }
  | { action: "ignore" };

const CATEGORIES = new Set(["monthly", "yearly", "misc", "investment"]);
const CURRENCIES = new Set(["ILS", "USD", "EUR"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await expensesUser();
  if ("res" in auth) return auth.res;
  const sb = auth.sb;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const { data: rec, error } = await sb.from(RECEIPTS).select("id, domain, status, decided_at").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // "skipped": a Rent bill the scan set aside before Rent existed, shown again (v1.24.4).
  if (rec.status !== "new" && rec.status !== "skipped") return NextResponse.json({ error: "Already decided." }, { status: 409 });
  const decided = { decided_at: new Date().toISOString() };
  // Every decision is conditional on the receipt still being open: the check above and the write
  // below are two requests, and someone else's Add can land between them.
  const OPEN = ["new", "skipped"];

  if (body?.action === "dismiss") {
    const upd = await sb.from(RECEIPTS).update({ status: "dismissed", ...decided }).eq("id", id).in("status", OPEN).select("id");
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    return upd.data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Already decided." }, { status: 409 });
  }
  if (body?.action === "ignore") {
    const ins = await sb.from(IGNORED).upsert({ domain: rec.domain }, { onConflict: "domain" });
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    // Every OPEN receipt from the sender goes — a set-aside ("skipped") Rent bill too, which
    // only `new` used to leave on the list after its sender was ignored.
    const upd = await sb.from(RECEIPTS).update({ status: "dismissed", ...decided }).eq("domain", rec.domain).in("status", OPEN);
    return upd.error ? NextResponse.json({ error: upd.error.message }, { status: 500 }) : NextResponse.json({ ok: true, domain: rec.domain });
  }
  if (body?.action === "rent") {
    const done = await fileRentBill(sb, id, { line: String(body.line ?? ""), months: Array.isArray(body.months) ? body.months.map(String) : [], amount: Number(body.amount), withVat: !!body.withVat, filesOnly: !!body.filesOnly, invoiceNumber: body.invoiceNumber, paidWith: body.paidWith });
    return "error" in done ? NextResponse.json({ error: done.error }, { status: done.status ?? 400 }) : NextResponse.json(done);
  }
  if (body?.action !== "add") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const vendor = String(body.vendor ?? "").trim();
  const date = String(body.date ?? "");
  if (!vendor || !CATEGORIES.has(body.category) || !CURRENCIES.has(body.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "Vendor, category, currency and day are needed." }, { status: 400 });
  const fx = buildFxTable(await fetchAll<FxRow>(sb, "fx_rates", "*"));
  const fields = amountFieldsOf({ amount: String(body.amount), currency: body.currency, withVat: !!body.withVat }, date, fx);
  if (!fields) return NextResponse.json({ error: "The amount isn't a number above zero." }, { status: 400 });
  const months = body.category === "yearly" ? Math.min(36, Math.max(1, Math.round(Number(body.renewMonths) || 12))) : null;

  const row = {
    date,
    category: body.category,
    vendor,
    description: String(body.description ?? "").trim(),
    ...fields,
    recurrence: body.category === "monthly" ? "monthly" : body.category === "yearly" ? "yearly" : "one_off",
    ...(months ? { renew_months: months } : {}),
    state: "actual",
  };
  // ⚠️ Claim the receipt BEFORE inserting the expense. Checking the status, inserting, then setting
  // "added" (ignoring its result) let two clicks — or a failed status write — add the same receipt
  // twice. "added" with no expense_id yet is the claim; every reader of "added" already skips a
  // null expense_id. Only the request whose conditional update returned the row goes on.
  const claim = await sb.from(RECEIPTS).update({ status: "added", ...decided }).eq("id", id).in("status", OPEN).select("id");
  if (claim.error) return NextResponse.json({ error: claim.error.message }, { status: 500 });
  if (!claim.data?.length) return NextResponse.json({ error: "Already decided." }, { status: 409 });

  // The invoice number and card ride along once reference/0018 is run.
  const paperwork = { invoice_number: String(body.invoiceNumber ?? "").trim().slice(0, 80) || null, paid_with: String(body.paidWith ?? "").trim().slice(0, 80) || null };
  let ins = await sb.from("finance_expenses").insert({ ...row, ...paperwork }).select("id").single();
  if (ins.error && /invoice_number|paid_with/.test(ins.error.message)) ins = await sb.from("finance_expenses").insert(row).select("id").single();
  if (ins.error) {
    // No expense was made: put the receipt back on the list as it was, so it can be added again.
    const back = await sb.from(RECEIPTS).update({ status: rec.status, decided_at: rec.decided_at ?? null }).eq("id", id).eq("status", "added").is("expense_id", null);
    const stuck = back.error ? ` The receipt is still marked added (${back.error.message}) — reopen it by hand.` : "";
    return NextResponse.json({ error: ins.error.message + stuck }, { status: 500 });
  }
  // From here the expense exists, so a failure is a warning (200, the list reloads), not a retry:
  // a retry would only meet "Already decided".
  const warnings: string[] = [];
  const link = await sb.from(RECEIPTS).update({ expense_id: ins.data.id }).eq("id", id);
  if (link.error) warnings.push(`the receipt couldn't be linked to it (${link.error.message})`);
  // Its documents now belong to the expense (reference/0019; quiet before it's run — a missing table).
  const docs = await sb.from(DOCS).update({ expense_id: ins.data.id }).eq("receipt_id", id);
  if (docs.error && docs.error.code !== "PGRST205" && docs.error.code !== "42P01") warnings.push(`its files stayed on the receipt (${docs.error.message})`);
  const warning = warnings.length ? `Added to Expenses, but ${warnings.join(" and ")}.` : undefined;
  return NextResponse.json({ ok: true, expenseId: ins.data.id, ...(warning ? { warning } : {}) });
}
