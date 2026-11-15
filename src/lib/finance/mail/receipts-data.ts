// Loads what the "From your mail" list shows (v1.14.0): the receipts still
// waiting (status new, last RECEIPT_DAYS days) set against the expense rows
// around them — server only, with the session of whoever is on Expenses (the
// owner, or an expenses-only admin since v1.18.0 / reference/0022). Only the
// owner's session reads the mail itself (`owner` below).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, updatePreservingLock } from "@/lib/finance/db";
import { isPeriodLocked, type FinanceLock, type FinanceState } from "@/lib/finance/finance";
import { matchVendor } from "./classify";
import { goodItem, receiptDetails, rowFill, senderKey, suggestions, type Attach, type ExpenseLite, type Known, type Receipt, type SuggestionsOut } from "./receipts";
import { rentLineOf, rentSince } from "./rent";
import { NOT_STUDIO } from "./rent-private";
import { DOCS, DOCS_RULES_FROM, fillReceiptDetails, readReceiptDocs, RECEIPT_DAYS, RECEIPTS, removeDocCopies } from "./scan";

type Row = Record<string, unknown>;
const COLS = "id, date, end_date, category, vendor, description, currency, amount_gross, renew_months, state";

export type SuggestionList = SuggestionsOut & { vendors?: string[]; attached?: number; filled?: number; rentLines?: string[] };

/** Covered receipts whose files are moved onto their row per load, newest first. */
const ATTACH_PER_LOAD = 20;

/**
 * Who the studio deals with (Nitsan, 2026-11-06): every Expenses vendor, the
 * tracker's clients (read only), freelancers (finance's Freelance rows and the
 * tracker's), and what earlier receipts from a sender were added as.
 */
async function knownOf(sb: SupabaseClient, owner: boolean): Promise<Known> {
  const y = new Date().getFullYear();
  const [vendors, clients, freelance, tracked, added] = await Promise.all([
    fetchAll<Row>(sb, "finance_expenses", "vendor", (q) => q.gte("date", `${y - 2}-01-01`)),
    fetchAll<Row>(sb, "clients", "name").catch(() => [] as Row[]),
    // Freelance rows are full finance; anyone else gets just the names (reference/0022).
    owner
      ? fetchAll<Row>(sb, "finance_freelance", "person_name", (q) => q.gte("year", y - 2)).catch(() => [] as Row[])
      : Promise.resolve(sb.rpc("finance_freelance_names", { since_year: y - 2 })).then(
          ({ data }) => ((data ?? []) as string[]).map((person_name) => ({ person_name }) as Row),
          () => [] as Row[],
        ),
    fetchAll<Row>(sb, "freelancers", "profile_id").catch(() => [] as Row[]),
    fetchAll<Row>(sb, RECEIPTS, "sender, domain, expense_id", (q) => q.eq("status", "added")).catch(() => [] as Row[]),
  ]);
  const ids = tracked.map((t) => String(t.profile_id));
  const people = ids.length ? await fetchAll<Row>(sb, "profiles", "id, name", (q) => q.in("id", ids)).catch(() => [] as Row[]) : [];
  const addedIds = added.map((a) => String(a.expense_id)).filter((x) => x && x !== "null");
  const became = addedIds.length ? await fetchAll<Row>(sb, "finance_expenses", "id, vendor", (q) => q.in("id", addedIds)).catch(() => [] as Row[]) : [];
  const vendorById = new Map(became.map((e) => [String(e.id), String(e.vendor).trim()]));
  const learned: Record<string, string> = {};
  for (const a of added) {
    const v = vendorById.get(String(a.expense_id));
    if (v) learned[senderKey({ sender: String(a.sender ?? ""), domain: String(a.domain) })] = v;
  }
  const uniq = (xs: Row[], k: string) => [...new Set(xs.map((x) => String(x[k] ?? "").trim()).filter(Boolean))];
  return { vendors: uniq(vendors, "vendor"), clients: uniq(clients, "name"), freelancers: [...uniq(freelance, "person_name"), ...uniq(people, "name")], learned };
}

/**
 * Null while reference/0016 hasn't been run. `owner`: only the owner's session
 * reads the mail itself (the mailbox tokens are the owner's alone) — anyone
 * else on Expenses (Michal, reference/0022) sees what that reading found.
 */
export async function loadSuggestions(sb: SupabaseClient, owner = true): Promise<SuggestionList | null> {
  const since = new Date(Date.now() - RECEIPT_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Rent bills reach back to the start of the year (v1.24.3); everything else, RECEIPT_DAYS.
  const rentFrom = rentSince(Date.now(), RECEIPT_DAYS).toISOString().slice(0, 10);
  const base = "id, vendor, suggested_vendor, sender, domain, sent_at, subject, account_email, amount, currency, gmail_message_id";
  // With the invoice number and card (reference/0018) when they exist.
  // "skipped" too: a Rent bill the scan set aside before Rent existed, or from a site on "never suggest" (Aluel).
  const read = (cols: string) => sb.from(RECEIPTS).select(`${cols}, status`).in("status", ["new", "skipped"]).gte("sent_at", rentFrom).order("sent_at");
  // Newest schema first: what was bought (0020), documents (0019), invoice number and card (0018), then 0016's own.
  const withLink = await read(`${base}, invoice_number, paid_with, docs_checked_at, item_description, invoice_url`);
  const withItem = withLink.error ? await read(`${base}, invoice_number, paid_with, docs_checked_at, item_description`) : withLink;
  const withDocs = withItem.error ? await read(`${base}, invoice_number, paid_with, docs_checked_at`) : withItem;
  const docsOn = !withDocs.error;
  const full = docsOn ? withDocs : await read(`${base}, invoice_number, paid_with`);
  const details = !full.error;
  const wait = details ? full : await read(base);
  if (wait.error) return null;
  const isRent = (r: Row) => !!rentLineOf({ domain: String(r.domain), subject: String(r.subject ?? "") }, [], {}, NOT_STUDIO) && !/^\s*(re|fwd?|fw)\s*:/i.test(String(r.subject ?? ""));
  const pending = ((wait.data ?? []) as unknown as Row[]).filter((r) => (r.status === "new" && String(r.sent_at).slice(0, 10) >= since) || isRent(r));
  if (!pending.length) return [];
  // Each receipt's Gmail message id, for the reads below.
  const msg = new Map(pending.map((r) => [String(r.id), String(r.gmail_message_id)]));
  const around = new Date(Date.parse(since) - 40 * 86_400_000).toISOString().slice(0, 10);
  const twoYears = `${new Date().getFullYear() - 2}-01-01`;
  // Recent rows, and every monthly subscription still running in the window.
  const [recent, open, endedLate] = await Promise.all([
    // Two years back: a vendor's older rows say how it bills (Figma's seats were monthly).
    fetchAll<Row>(sb, "finance_expenses", COLS, (q) => q.gte("date", around < twoYears ? around : twoYears)),
    fetchAll<Row>(sb, "finance_expenses", COLS, (q) => q.eq("category", "monthly").is("end_date", null)),
    fetchAll<Row>(sb, "finance_expenses", COLS, (q) => q.eq("category", "monthly").gte("end_date", since)),
  ]);
  const byId = new Map([...recent, ...open, ...endedLate].map((r) => [String(r.id), r]));
  const rows: ExpenseLite[] = [...byId.values()].map((r) => ({
    id: String(r.id),
    date: String(r.date),
    endDate: (r.end_date as string | null) ?? null,
    category: String(r.category),
    vendor: String(r.vendor ?? ""),
    description: String(r.description ?? ""),
    currency: String(r.currency ?? "ILS"),
    gross: Number(r.amount_gross),
    renewMonths: r.renew_months == null ? null : Number(r.renew_months),
    state: String(r.state ?? ""),
  }));
  const receipts: Receipt[] = pending.map((r) => ({
    id: String(r.id),
    vendor: (r.vendor as string | null) ?? null,
    suggestedVendor: String(r.suggested_vendor),
    sender: String(r.sender ?? ""),
    domain: String(r.domain),
    date: String(r.sent_at).slice(0, 10),
    subject: String(r.subject ?? ""),
    account: String(r.account_email),
    amount: r.amount == null ? null : Number(r.amount),
    currency: (r.currency as string | null) ?? null,
    invoiceNumber: String(r.invoice_number ?? "").trim() || (r.invoice_number == null ? null : (receiptDetails("", String(r.subject ?? "")).invoice ?? "")),
    paidWith: (r.paid_with as string | null) ?? null,
    // Checked again as it's read: a line that slipped past an older rule (who was billed) never shows.
    itemDescription: r.item_description && goodItem(String(r.item_description)) ? String(r.item_description) : null,
    invoiceUrl: typeof r.invoice_url === "string" && r.invoice_url.startsWith("https://") ? r.invoice_url : null,
  }));
  const known: Known = { ...(await knownOf(sb, owner)), notStudio: NOT_STUDIO };
  const list: SuggestionList = suggestions(receipts, rows, known, matchVendor, new Date().toISOString().slice(0, 10));
  // A Rent bill's months locked on the Rent tab (Finalize month): its file and number only.
  if (list.some((x) => x.category === "rent")) {
    const locks = await fetchAll<Row>(sb, "finance_locks", "scope_year, scope_month, block").catch(() => [] as Row[]);
    const lockList: FinanceLock[] = locks.map((l) => ({ scopeYear: Number(l.scope_year), scopeMonth: l.scope_month == null ? null : Number(l.scope_month), block: l.block as FinanceLock["block"] }));
    for (const x of list)
      if (x.rentMonths) x.rentLocked = x.rentMonths.map((m) => isPeriodLocked(lockList, Number(m.slice(0, 4)), Number(m.slice(5, 7)), "expenses"));
    // Every month locked and every cell there: all a card could do is attach — so it's done, no card
    // (Nitsan, 2026-11-09: "for past months don't send me to bring files").
    const done = list.filter((x) => x.category === "rent" && x.rentLocked?.length && x.rentLocked.every(Boolean) && x.rentCells?.every(Boolean));
    for (const x of done) {
      const cells = x.rentCells as string[];
      (list.attach ??= []).push({ receiptId: x.id, expenseId: cells[0], date: x.date, also: cells.slice(1).map((id, i) => ({ expenseId: id, month: x.rentMonths![i + 1] })), rent: true });
      list.cleared = { ...list.cleared, "on-expenses": (list.cleared?.["on-expenses"] ?? 0) + 1 };
      list.splice(list.indexOf(x), 1);
    }
  }
  // Every Expenses vendor, for the vendor box's own suggestions.
  list.vendors = [...known.vendors].sort((a, b) => a.localeCompare(b));
  // The Rent tab's lines in use, for a bill filed there (v1.24.0): a cell in the last six months
  // (Nitsan, 2026-11-09: "מטבח - ק.ק is an old line I don't use any more" — its last cell is 2024).
  const inUse = new Date(Date.now() - 183 * 86_400_000).toISOString().slice(0, 10);
  list.rentLines = [...new Set(rows.filter((r) => r.category === "rent" && r.date >= inUse).map((r) => r.vendor.trim()))].sort((a, b) => a.localeCompare(b, "he"));
  // Receipts scanned before the invoice number and card were read: read them now, once.
  if (details && owner) {
    const unread = list.filter((s) => s.invoiceNumber == null).slice(0, 25);
    const got = await fillReceiptDetails(
      sb,
      unread.map((s) => ({ id: s.id, account: s.account, messageId: msg.get(s.id) ?? "" })),
    ).catch(() => new Map<string, { invoice: string; paidWith: string }>());
    for (const s of list) {
      const g = got.get(s.id);
      if (g) Object.assign(s, { invoiceNumber: g.invoice, paidWith: g.paidWith });
    }
  }
  // Documents (v1.16.0): receipts the list shows whose email hasn't been read for them (or not since v1.16.1's
  // rules), then each one's files — copies of one file removed.
  if (docsOn) {
    const stale = new Set(pending.filter((r) => r.docs_checked_at == null || String(r.docs_checked_at) < DOCS_RULES_FROM).map((r) => String(r.id)));
    const toRead = owner ? list.filter((s) => stale.has(s.id)).slice(0, 15) : [];
    await readReceiptDocs(
      sb,
      toRead.map((s) => ({ id: s.id, account: s.account, messageId: msg.get(s.id) ?? "" })),
    ).catch(() => 0);
    // What the reading found (amount, number, card, item) shows at once, without another load.
    if (toRead.length) {
      const again = await sb.from(RECEIPTS).select("*").in("id", toRead.map((s) => s.id));
      for (const g of (again.data ?? []) as Row[]) {
        const s = list.find((x) => x.id === String(g.id));
        if (!s) continue;
        if (s.amount == null && g.amount != null) Object.assign(s, { amount: Number(g.amount), currency: g.currency ?? null });
        if (!s.invoiceNumber && g.invoice_number) s.invoiceNumber = String(g.invoice_number);
        if (!s.paidWith && g.paid_with) s.paidWith = String(g.paid_with);
        if (typeof g.invoice_url === "string" && g.invoice_url.startsWith("https://")) s.invoiceUrl = g.invoice_url;
        if (g.item_description && goodItem(String(g.item_description))) Object.assign(s, { itemDescription: String(g.item_description), description: String(g.item_description) });
      }
    }
    const files = await fetchAll<Row>(sb, DOCS, "id, path, receipt_id, filename, mime, size", (q) => q.in("receipt_id", list.map((s) => s.id))).catch(() => [] as Row[]);
    const gone = await removeDocCopies(
      sb,
      files.map((f) => ({ id: String(f.id), path: String(f.path), owner: String(f.receipt_id), filename: String(f.filename), size: Number(f.size ?? 0) })),
    ).catch(() => new Set<string>());
    for (const s of list)
      s.docs = files
        .filter((f) => String(f.receipt_id) === s.id && !gone.has(String(f.id)))
        .map((f) => ({ id: String(f.id), filename: String(f.filename), mime: String(f.mime ?? ""), size: Number(f.size ?? 0) }));
  }
  // Receipts already on Expenses (v1.22.0): their files go on the row that covers them, each under its month.
  if (docsOn && owner && list.attach?.length) {
    const where = new Map(pending.map((r) => [String(r.id), { account: String(r.account_email), messageId: String(r.gmail_message_id) }]));
    list.attached = await attachCovered(sb, list.attach, where).catch(() => 0);
  }
  // …and what their receipts say goes into the rows' empty fields: card, invoice number, description.
  if (owner) list.filled = await fillRows(sb, rentFrom).catch(() => 0);
  // The email itself, in Gmail, for a receipt with no file attached.
  for (const s of list) s.mailUrl = `https://mail.google.com/mail/?authuser=${encodeURIComponent(s.account)}#all/${msg.get(s.id) ?? ""}`;
  return list;
}

/**
 * A receipt the Expenses rows already cover (Nitsan, 2026-11-09: Anthropic's
 * $75 for the 3 seats, Plnty's renewal — "the invoice file wasn't added"):
 * its files are read from the mail and put on that row, and the receipt is
 * marked added to it, so the Monthly row's files fill in month by month.
 * Only once its email has really been read for files — a local copy without
 * the mail keys reads nothing and must leave it for the live site.
 */
async function attachCovered(sb: SupabaseClient, attach: Attach[], msg: Map<string, { account: string; messageId: string }>): Promise<number> {
  const todo = [...attach].sort((a, b) => b.date.localeCompare(a.date)).slice(0, ATTACH_PER_LOAD);
  await readReceiptDocs(
    sb,
    todo.flatMap((a) => {
      const m = msg.get(a.receiptId);
      return m ? [{ id: a.receiptId, ...m }] : [];
    }),
  );
  const read = await sb.from(RECEIPTS).select("id, docs_checked_at").in("id", todo.map((a) => a.receiptId));
  if (read.error) return 0;
  const done = new Set(((read.data ?? []) as Row[]).filter((r) => r.docs_checked_at && String(r.docs_checked_at) >= DOCS_RULES_FROM).map((r) => String(r.id)));
  let moved = 0;
  for (const a of todo) {
    if (!done.has(a.receiptId)) continue;
    const docs = await sb.from(DOCS).update({ expense_id: a.expenseId }).eq("receipt_id", a.receiptId).is("expense_id", null);
    if (docs.error) continue;
    const rec = await sb.from(RECEIPTS).update({ status: "added", expense_id: a.expenseId }).eq("id", a.receiptId).in("status", ["new", "skipped"]);
    if (!rec.error) moved++;
    // A two-month Rent bill (v1.24.0): its other month's cell gets a copy of the files, number and card.
    if (a.also?.length) await copyToCells(sb, a.receiptId, a.also).catch(() => undefined);
    // A Rent cell keeps the bill's link (v1.24.4: Idan Shani's confirmation is only a link).
    if (a.rent) await keepBillLink(sb, a.receiptId, [a.expenseId, ...(a.also ?? []).map((c) => c.expenseId)]).catch(() => undefined);
  }
  return moved;
}

/**
 * Rows a mail receipt was put on (added from the list, or covered — v1.22.0)
 * get what their receipts read where the row is empty (v1.23.0): the card,
 * the invoice number (not on Monthly rows — one per month, shown in their
 * files table) and what was bought (`rowFill`). Receipts of the last
 * RECEIPT_DAYS; quiet before reference/0018. Returns how many rows changed.
 */
async function fillRows(sb: SupabaseClient, since: string): Promise<number> {
  const recs = await fetchAll<Row>(sb, RECEIPTS, "expense_id, sent_at, subject, invoice_number, paid_with, item_description", (q) =>
    q.eq("status", "added").not("expense_id", "is", null).gte("sent_at", since),
  );
  const ids = [...new Set(recs.map((r) => String(r.expense_id)))];
  if (!ids.length) return 0;
  const rows = await fetchAll<Row>(sb, "finance_expenses", "id, category, state, invoice_number, paid_with, description", (q) => q.in("id", ids));
  let changed = 0;
  for (const row of rows) {
    const mine = recs.filter((r) => String(r.expense_id) === String(row.id));
    const patch = rowFill(
      {
        category: String(row.category),
        state: (row.state as string | null) ?? null,
        invoiceNumber: (row.invoice_number as string | null) ?? null,
        paidWith: (row.paid_with as string | null) ?? null,
        description: String(row.description ?? ""),
      },
      mine.map((r) => ({
        date: String(r.sent_at).slice(0, 10),
        // Read before the subject's number was ("חשבונית מרכזת - SI…"): the subject still has it.
        invoiceNumber: String(r.invoice_number ?? "").trim() || receiptDetails("", String(r.subject ?? "")).invoice,
        paidWith: (r.paid_with as string | null) ?? null,
        item: (r.item_description as string | null) ?? null,
      })),
    );
    if (!Object.keys(patch).length) continue;
    const up = await sb.from("finance_expenses").update(patch).eq("id", String(row.id)).neq("state", "final").select("id");
    if (!up.error && up.data?.length) changed++;
  }
  return changed;
}

/**
 * A Rent bill covers two months — two cells, two rows (v1.24.0): the second
 * gets the bill's invoice number and card where it has none. Its files stay on
 * the first (v1.24.10).
 */
export async function copyToCells(sb: SupabaseClient, receiptId: string, cells: { expenseId: string; month: string }[]): Promise<void> {
  // The bill's files stay on its first month only (Nitsan, 2026-11-09: "no need to add a 2-month invoice
  // twice"): the Rent grid marks the other month with a dimmed icon that opens them. Its number and card still go.
  const rec = await sb.from(RECEIPTS).select("invoice_number, paid_with").eq("id", receiptId).maybeSingle();
  for (const c of cells) {
    const r = (rec.data ?? {}) as Row;
    const paperwork = Object.fromEntries(
      [
        ["invoice_number", r.invoice_number],
        ["paid_with", r.paid_with],
      ].filter(([, v]) => typeof v === "string" && v.trim()),
    );
    if (!Object.keys(paperwork).length) continue;
    const row = await sb.from("finance_expenses").select("invoice_number, paid_with, state").eq("id", c.expenseId).maybeSingle();
    const cur = (row.data ?? {}) as Row;
    if (cur.state === "final") continue;
    const patch = Object.fromEntries(Object.entries(paperwork).filter(([k]) => !String(cur[k] ?? "").trim()));
    if (Object.keys(patch).length) await sb.from("finance_expenses").update(patch).eq("id", c.expenseId);
  }
}

/**
 * A Rent bill's link on its cells (v1.24.4, Nitsan 2026-11-09: "the file is in
 * a link, so just add the link as it is"): the receipt's invoice link, in the
 * cell's empty `link` — a final cell stays final.
 */
export async function keepBillLink(sb: SupabaseClient, receiptId: string, expenseIds: string[]): Promise<void> {
  const rec = await sb.from(RECEIPTS).select("invoice_url").eq("id", receiptId).maybeSingle();
  const url = (rec.data as Row | null)?.invoice_url;
  if (typeof url !== "string" || !url.startsWith("https://")) return;
  const rows = await fetchAll<Row>(sb, "finance_expenses", "id, link, state", (q) => q.in("id", expenseIds));
  for (const r of rows) if (!String(r.link ?? "").trim()) await updatePreservingLock(sb, "finance_expenses", String(r.id), { link: url }, r.state as FinanceState);
}
