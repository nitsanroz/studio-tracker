// The billing-mail scan (v1.12.0, Nitsan 2026-11-05): every connected mailbox
// (Settings — nitsan@, office@, studio@) is searched for mail from vendors on
// the Expenses page that talks about billing; each hit becomes one
// `finance_tool_mail` row (vendor, kind, date, subject, amount). Never the body.
//
// ⚠️ SERVER ONLY, with the OWNER's own session (reference/0015 is owner-only).
// Runs in the background from any page every MAIL_EVERY_MS (advice/run.ts),
// and from "Scan now" / "Read now". The first scan reads 400 days back; later
// ones start a day before the newest message already read.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/finance/db";
import { amountIn, classify, matchVendor, searchQuery } from "./classify";
import { rentLineOf, rentQuery, rentSince } from "./rent";
import { readSlip, slipCode } from "./tlv-slip";
import { decryptToken } from "./crypto";
import { accessTokenFor, getAttachment, getMessageFull, getMessageMeta, GmailError, listMessages, mailConfigured, type GmailFull } from "./google";
import { attachmentsOf, bodyText, storageName, invoiceLink, linkTo, isPaidReceipt, receiptAmount, rtlPdfTotal, receiptDescription, receiptDetails, receiptQuery, senderDomain, vendorFromSender, type Attachment } from "./receipts";

export const ACCOUNTS = "finance_mail_accounts";
export const TOOL_MAIL = "finance_tool_mail";
export const RECEIPTS = "finance_mail_receipts";
export const IGNORED = "finance_mail_ignored";
/** Documents (reference/0019): the private bucket and its table. */
const DOCS_BUCKET = "finance-docs";
export const DOCS = "finance_documents";
/** How far back receipts are suggested as expenses (v1.14.0). */
export const RECEIPT_DAYS = 120;
/** At most this many receipts read in full per mailbox per scan; the next scan reads on. */
const MAX_RECEIPTS = 250;

/** One scan reads at most this many messages a mailbox; the next scan picks up the rest. */
const MAX_MESSAGES = 600;
const PARALLEL = 10;
/** Listing is cheap (500 ids a page), but bounded: 20 pages = 10,000 ids. */
const MAX_LIST_PAGES = 20;

type Row = Record<string, unknown>;

export interface ScanResult {
  email: string;
  read: number;
  kept: number;
  /** receipts read for an amount this scan (v1.14.0) */
  receipts: number;
  error: string | null;
}

/**
 * The vendors worth matching: every monthly and yearly row from two years
 * back, latest row first. matchVendor keeps the first of equal matches, so
 * Anthropic's mail goes to the plan the studio pays now ("Claude pro"), not
 * one that ended (Nitsan, 2026-11-08: "Claude max" was a one-off).
 */
async function vendorsOf(sb: SupabaseClient): Promise<string[]> {
  const y = new Date().getFullYear();
  const rows = await fetchAll<Row>(sb, "finance_expenses", "vendor, date", (q) => q.in("category", ["monthly", "yearly"]).gte("date", `${y - 2}-01-01`));
  rows.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return [...new Set(rows.map((r) => String(r.vendor ?? "").trim()).filter(Boolean))];
}

async function inBatches<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return out;
}

const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/**
 * Every id matching `q` that isn't in `skip`, newest first (Gmail's order),
 * and whether the listing reached its end. Before 2026-11-09 the scans listed
 * only the newest few hundred ids — stored ones counted — and then moved their
 * "read up to" mark past them, so mail beyond the cap was never read.
 */
async function listFresh(at: string, q: string, skip: Set<string>): Promise<{ ids: string[]; complete: boolean }> {
  const ids: string[] = [];
  let page: string | undefined;
  let pages = 0;
  do {
    const res = await listMessages(at, q, page);
    for (const m of res.messages ?? []) if (!skip.has(m.id)) ids.push(m.id);
    page = res.nextPageToken;
  } while (page && ++pages < MAX_LIST_PAGES);
  return { ids, complete: !page };
}

/** Scan one mailbox. Errors are written to its row, never thrown. */
async function scanAccount(sb: SupabaseClient, account: Row, vendors: string[]): Promise<ScanResult> {
  const email = String(account.email);
  const started = new Date().toISOString();
  try {
    const at = await accessTokenFor(decryptToken(String(account.refresh_token_enc)));
    const until = account.scanned_until ? new Date(String(account.scanned_until)) : null;
    const q = searchQuery(vendors, until ? new Date(until.getTime() - 86_400_000) : null);

    const known = new Set(
      (await fetchAll<Row>(sb, TOOL_MAIL, "gmail_message_id", (q2) => q2.eq("account_email", email))).map((r) => String(r.gmail_message_id)),
    );
    // Over the cap → the OLDEST unread first: the mark then moves to the newest of
    // those, everything before it is read, and the next scan reads on from there.
    // (Mail that matches no vendor kind is never stored, so skipping stored ids
    // alone couldn't move a newest-first scan past it.)
    const fresh = (await listFresh(at, q, known)).ids.slice(-MAX_MESSAGES);
    const metas = await inBatches(fresh, PARALLEL, (id) => getMessageMeta(at, id));

    let newest = until?.getTime() ?? 0;
    const rows = metas.flatMap((m) => {
      const sent = Number(m.internalDate ?? 0);
      newest = Math.max(newest, sent);
      const sender = header(m, "From");
      const subject = header(m, "Subject");
      const vendor = matchVendor(sender, vendors);
      const kind = vendor ? classify(subject, m.snippet ?? "") : null;
      if (!vendor || !kind) return [];
      // The amount is read from the subject and preview line; neither is stored beyond the subject.
      const money = amountIn(`${subject} ${m.snippet ?? ""}`);
      return [
        {
          account_email: email,
          gmail_message_id: m.id,
          vendor,
          kind,
          sent_at: new Date(sent).toISOString(),
          sender: sender.slice(0, 200),
          subject: subject.slice(0, 300),
          amount: money?.amount ?? null,
          currency: money?.currency ?? null,
        },
      ];
    });
    if (rows.length) {
      const put = await sb.from(TOOL_MAIL).upsert(rows, { onConflict: "account_email,gmail_message_id", ignoreDuplicates: true });
      if (put.error) throw new Error(`${TOOL_MAIL}: ${put.error.message}`);
    }
    await sb
      .from(ACCOUNTS)
      .update({ status: "ok", last_error: null, last_scan_at: started, ...(newest ? { scanned_until: new Date(newest).toISOString() } : {}) })
      .eq("email", email);
    // Receipts → expenses to approve (v1.14.0). Its own failure never fails the billing scan.
    const receipts = await scanReceipts(sb, account, at, vendors).catch(() => 0);
    return { email, read: metas.length, kept: rows.length, receipts, error: null };
  } catch (e) {
    const revoked = e instanceof GmailError && e.status === 400 && /invalid_grant|revoked|expired/i.test(e.message);
    const error = (e as Error).message.slice(0, 300);
    await sb.from(ACCOUNTS).update({ status: revoked ? "revoked" : "error", last_error: error, last_scan_at: started }).eq("email", email);
    return { email, read: 0, kept: 0, receipts: 0, error };
  }
}

/**
 * Receipts to suggest as expenses (v1.14.0): the billing scan's receipts from
 * Expenses vendors, plus a search for receipts from anyone. Each is read in
 * full ONLY for its amount (Nitsan's choice, 2026-11-05) and kept as one
 * `finance_mail_receipts` row — sender, subject, day, amount; never the text.
 * Returns how many were read; 0 quietly while reference/0016 isn't run.
 */
async function scanReceipts(sb: SupabaseClient, account: Row, at: string, vendors: string[]): Promise<number> {
  const email = String(account.email);
  const since = new Date(Date.now() - RECEIPT_DAYS * 86_400_000);
  const known = await fetchAll<Row>(sb, RECEIPTS, "gmail_message_id", (q) => q.eq("account_email", email));
  const seen = new Set(known.map((r) => String(r.gmail_message_id)));

  // 1. The billing scan's receipts from Expenses vendors (and its backlog).
  const fromVendors = await fetchAll<Row>(sb, TOOL_MAIL, "gmail_message_id", (q) => q.eq("account_email", email).eq("kind", "receipt").gte("sent_at", since.toISOString()));
  // 2. Receipts from anyone, since the last receipt search.
  const until = account.receipts_until ? new Date(String(account.receipts_until)) : null;
  const q = receiptQuery(until ? new Date(Math.max(until.getTime() - 86_400_000, since.getTime())) : null, RECEIPT_DAYS);
  const vendorIds = new Set(fromVendors.map((r) => String(r.gmail_message_id)));
  const fromVendorsNew = [...vendorIds].filter((id) => !seen.has(id));
  const found = await listFresh(at, q, new Set([...seen, ...vendorIds]));
  // 3. The Rent tab's bills (v1.24.0): electricity, arnona, water, Partner, the rent — whatever the subject says.
  // From the start of the year (Nitsan, 2026-11-09: "all of 2026's rent months").
  const rentFrom = rentSince(Date.now(), RECEIPT_DAYS);
  const rentDays = Math.ceil((Date.now() - rentFrom.getTime()) / 86_400_000);
  const rent = await listFresh(at, rentQuery(rentDays), new Set([...seen, ...vendorIds, ...found.ids])).catch(() => ({ ids: [] as string[], complete: true }));
  const all = [...fromVendorsNew, ...found.ids, ...rent.ids];
  const ids = all.slice(0, MAX_RECEIPTS);
  // Newest first here — every message read is stored (skipped or not), so the
  // next scan skips it and reads on; the search's mark moves only once all of
  // what it found has been read.
  const searchDone = found.complete && all.length <= MAX_RECEIPTS;
  const ignored = new Set((await fetchAll<Row>(sb, IGNORED, "domain")).map((r) => String(r.domain)));
  const full = await inBatches(ids, PARALLEL, (id) => getMessageFull(at, id).catch(() => null));

  const rows = full.flatMap((m) => {
    if (!m) return [];
    const sent = Number(m.internalDate ?? 0);
    const from = header(m, "From");
    const subject = header(m, "Subject");
    const domain = senderDomain(from);
    // Older than the receipts' window: only a Rent bill of this year is kept.
    if (sent < since.getTime() && !(sent >= rentFrom.getTime() && rentLineOf({ domain, subject }))) return [];
    const vendor = matchVendor(from, vendors);
    // A vendor's receipt the billing scan already sorted counts; anyone else's must read as one.
    const paid = vendorIds.has(m.id) || isPaidReceipt(from, subject, m.snippet ?? "") || !!rentLineOf({ domain, subject });
    // The amount, invoice number and card come from the text, read here and dropped.
    const text = paid ? bodyText(m.payload) : "";
    const money = paid ? (receiptAmount(text) ?? amountIn(`${subject} ${m.snippet ?? ""}`)) : null;
    const details = paid ? receiptDetails(text, subject) : null;
    return [
      {
        account_email: email,
        gmail_message_id: m.id,
        sender: from.slice(0, 200),
        domain,
        vendor,
        suggested_vendor: (vendor ?? vendorFromSender(from)).slice(0, 80) || domain,
        subject: subject.slice(0, 300),
        sent_at: new Date(sent).toISOString(),
        amount: money?.amount ?? null,
        currency: money?.currency ?? null,
        // A Rent bill goes through even from a site on "never suggest" (Aluel was, before Rent existed).
        status: paid && (!ignored.has(domain) || !!rentLineOf({ domain, subject })) ? "new" : "skipped",
        // "" = read, none found (reference/0018)
        invoice_number: details ? (details.invoice ?? "") : null,
        paid_with: details ? (details.paidWith ?? "") : null,
        // what was bought (reference/0020); the PDF may add it when the docs are read
        item_description: paid ? (receiptDescription(text) ?? null) : null,
        // where to get the invoice when it isn't attached (reference/0021)
        invoice_url: paid ? invoiceLink(m.payload) : null,
      },
    ];
  });
  if (rows.length) {
    // Columns a later SQL file adds (0018 invoice/card, 0020 item) are dropped while it isn't run.
    let cols = rows;
    let put = await sb.from(RECEIPTS).upsert(cols, { onConflict: "account_email,gmail_message_id", ignoreDuplicates: true }).select("id, gmail_message_id, status");
    for (const late of [["invoice_url"], ["item_description"], ["invoice_number", "paid_with"]]) {
      if (!put.error || !late.some((c) => put.error!.message.includes(c))) continue;
      cols = cols.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !late.includes(k)))) as typeof rows;
      put = await sb.from(RECEIPTS).upsert(cols, { onConflict: "account_email,gmail_message_id", ignoreDuplicates: true }).select("id, gmail_message_id, status");
    }
    if (put.error) throw new Error(`${RECEIPTS}: ${put.error.message}`);
    // New receipts bring their documents in now (v1.16.0); older ones when the list first shows them.
    const fresh = ((put.data ?? []) as Row[]).filter((r) => r.status === "new").slice(0, 40);
    await readReceiptDocs(sb, fresh.map((r) => ({ id: String(r.id), account: email, messageId: String(r.gmail_message_id) }))).catch(() => 0);
    // The billing scan only saw the subject: give its receipts their amount too (receiptMismatch reads it).
    // One row each, so they run side by side.
    await Promise.all(
      rows
        .filter((r) => r.amount != null && vendorIds.has(r.gmail_message_id))
        .map((r) => sb.from(TOOL_MAIL).update({ amount: r.amount, currency: r.currency }).eq("account_email", email).eq("gmail_message_id", r.gmail_message_id).is("amount", null)),
    );
  }
  if (searchDone) await sb.from(ACCOUNTS).update({ receipts_until: new Date().toISOString() }).eq("email", email);
  return rows.length;
}

/**
 * The invoice number and card of receipts scanned before v1.15.1 read them
 * (Nitsan, 2026-11-06): each is fetched once more, only these two strings
 * taken, and written back ("" = read, none found) so it's never read again.
 * For the few receipts the "From your mail" list shows; quiet on any failure.
 */
export async function fillReceiptDetails(sb: SupabaseClient, rows: { id: string; account: string; messageId: string }[]): Promise<Map<string, { invoice: string; paidWith: string }>> {
  const out = new Map<string, { invoice: string; paidWith: string }>();
  await eachMessage(sb, rows, async (r, m) => {
    const d = receiptDetails(bodyText(m.payload), header(m, "Subject"));
    const found = { invoice: d.invoice ?? "", paidWith: d.paidWith ?? "" };
    const upd = await sb.from(RECEIPTS).update({ invoice_number: found.invoice, paid_with: found.paidWith }).eq("id", r.id);
    if (!upd.error) out.set(r.id, found);
  });
  return out;
}

type MessageRef = { id: string; account: string; messageId: string; stored?: Row };

/** Fetch each receipt's message from its own mailbox and hand it on; a mailbox or message that fails is skipped. */
async function eachMessage(sb: SupabaseClient, rows: MessageRef[], fn: (r: MessageRef, m: GmailFull, at: string) => Promise<void>) {
  if (!rows.length || !mailConfigured()) return;
  const accounts = await fetchAll<Row>(sb, ACCOUNTS, "email, refresh_token_enc, status", (q) => q.in("email", [...new Set(rows.map((r) => r.account))]));
  await Promise.all(
    accounts
      .filter((a) => a.status !== "revoked")
      .map(async (a) => {
        const at = await accessTokenFor(decryptToken(String(a.refresh_token_enc))).catch(() => null);
        if (!at) return;
        await inBatches(
          rows.filter((r) => r.account === a.email),
          PARALLEL,
          async (r) => {
            const m = await getMessageFull(at, r.messageId).catch(() => null);
            if (m) await fn(r, m, at).catch(() => undefined);
          },
        );
      }),
  );
}

/**
 * Receipts whose documents were looked for before this date are looked at
 * once more (v1.16.1): files sent as "octet-stream" (Wolt's) were missed, and
 * the PDF's text wasn't read for the amount and what was bought. Moved to the
 * v1.16.2 release hour: a local copy without the mail keys had marked nine
 * receipts read without reading them (since guarded in readReceiptDocs). And
 * again for v1.16.3 (Wolt's totals, BuyMe's items) and v1.17.0 (invoice links),
 * and for v1.24.2: a Hebrew file name failed the upload (Storage keys are
 * ASCII only) and left the receipt read with no file — Aluel's rent invoices;
 * and for v1.24.4: Idan Shani's "סכום ששולם 199" (no ₪ sign) and its link;
 * v1.24.5: the month a payment is for ("שולם לחודש מאי - 2026"); v1.24.6:
 * Tel Aviv's arnona slips, read from their link.
 */
export const DOCS_RULES_FROM = "2026-11-09T13:45:00Z";

/** A PDF's text, read and dropped like the email's (unpdf, the payslip reader's library). Empty on any failure. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return "";
  }
}

const bytesOf = async (at: string, messageId: string, a: Attachment) =>
  a.data ? Buffer.from(a.data, "base64url") : getAttachment(at, messageId, a.attachmentId);

/**
 * A receipt's documents (v1.16.0, Nitsan 2026-11-06: "preview and download
 * them"): its PDF and scan attachments are saved to the private
 * `finance-docs` bucket and listed in `finance_documents` against the
 * receipt — and against its expense once it's added. Its PDFs are read too
 * (v1.16.1), for what the email itself didn't say: the amount, invoice
 * number, card and what was bought — only those short fields are kept.
 *
 * Each receipt is CLAIMED before its files are saved (docs_checked_at set where
 * it was empty or older than DOCS_RULES_FROM), once its email has been
 * fetched, so two loads at once can't both save its files
 * — Gmail gives an attachment a new id on every read, which once saved every
 * file three times. A file is saved under its place and name in the email,
 * and skipped when the receipt already has one of that name and size.
 * Returns how many files were saved; 0 quietly before reference/0019.
 */
export async function readReceiptDocs(sb: SupabaseClient, rows: MessageRef[]): Promise<number> {
  // Without the mail keys (a local copy) nothing can be read — claim nothing, or the live site would skip them.
  if (!rows.length || !mailConfigured()) return 0;
  let saved = 0;
  await eachMessage(sb, rows, async (ref, m, at) => {
    // Claimed only now that its mailbox gave a token and the email itself came
    // back (2026-11-09): a revoked mailbox or a failed fetch used to leave the
    // receipt claimed and never read — and attachCovered then took it as read.
    const c = await sb
      .from(RECEIPTS)
      .update({ docs_checked_at: new Date().toISOString() })
      .eq("id", ref.id)
      .or(`docs_checked_at.is.null,docs_checked_at.lt.${DOCS_RULES_FROM}`)
      .select("*");
    if (c.error || !c.data?.length) return;
    const r: MessageRef = { ...ref, stored: c.data[0] as Row };
    const have = await fetchAll<Row>(sb, DOCS, "filename, size", (q) => q.eq("receipt_id", r.id)).catch(() => [] as Row[]);
    const texts: string[] = [];
    let i = 0;
    for (const a of attachmentsOf(m.payload)) {
      i++;
      const bytes = await bytesOf(at, r.messageId, a);
      if (a.mime === "application/pdf") texts.push(await pdfText(bytes));
      if (have.some((h) => h.filename === a.filename && Number(h.size) === bytes.length)) continue;
      const path = `mail/${r.id}/${i}-${storageName(a.filename, "receipt")}`;
      const up = await sb.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: a.mime, upsert: true });
      // One file that won't save mustn't stop the rest, nor the reading below.
      if (up.error) continue;
      const ins = await sb.from(DOCS).upsert({ receipt_id: r.id, path, filename: a.filename, mime: a.mime, size: bytes.length, source: "mail" }, { onConflict: "path" });
      if (ins.error) continue;
      saved++;
    }
    // The email first, then its PDFs, for whatever the stored row is missing.
    const body = bodyText(m.payload);
    const subject = header(m, "Subject");
    const all = [body, ...texts].join("\n");
    const st = r.stored ?? {};
    const patch: Record<string, unknown> = {};
    if (st.amount == null) {
      // A bill's own PDF total first (Partner, IEC): its email may name another bill's amount.
      const money = texts.map(rtlPdfTotal).find(Boolean) ?? receiptAmount(body) ?? texts.map(receiptAmount).find(Boolean) ?? null;
      if (money) Object.assign(patch, { amount: money.amount, currency: money.currency });
    }
    const d = receiptDetails(all, subject);
    if (!st.invoice_number && d.invoice) patch.invoice_number = d.invoice;
    if (!st.paid_with && d.paidWith) patch.paid_with = d.paidWith;
    const item = receiptDescription(...texts, body);
    if (Object.keys(patch).length) await sb.from(RECEIPTS).update(patch).eq("id", r.id);
    // Their own columns (reference/0020, 0021): a failure there mustn't lose the rest.
    await sb.from(RECEIPTS).update({ item_description: item ?? "" }).eq("id", r.id);
    // A bill behind a login (water): the email's own link to the supplier's site, whatever its button says.
    const src = rentLineOf({ domain: senderDomain(header(m, "From")), subject });
    const link = invoiceLink(m.payload) ?? (src?.loginOnly ? linkTo(m.payload, src.sites[0] ?? "") : null);
    await sb.from(RECEIPTS).update({ invoice_url: link }).eq("id", r.id);
    // Tel Aviv's arnona slip (v1.24.6): the email only links to it — the slip's site gives its total,
    // months, voucher number and PDF for the link's code.
    const slip = slipCode(link) ? await readSlip(link!) : null;
    if (slip) {
      const fix: Record<string, unknown> = {};
      if (st.amount == null) Object.assign(fix, { amount: slip.amount, currency: "ILS" });
      if (!st.invoice_number && slip.voucher) fix.invoice_number = slip.voucher;
      if (!st.paid_with && slip.byCard) fix.paid_with = "Credit card";
      // The months as "11/2026-12/2026", which the Rent matching reads as the bill's period.
      if (slip.months.length) fix.item_description = `ארנונה ${slip.months.map((x) => `${x.slice(5)}/${x.slice(0, 4)}`).join("-")}`;
      if (Object.keys(fix).length) await sb.from(RECEIPTS).update(fix).eq("id", r.id);
      if (slip.pdf && slip.pdfName && !have.some((h) => h.filename === slip.pdfName)) {
        const path = `mail/${r.id}/slip-${storageName(slip.pdfName, "arnona")}`;
        const up = await sb.storage.from(DOCS_BUCKET).upload(path, slip.pdf, { contentType: "application/pdf", upsert: true });
        if (!up.error) await sb.from(DOCS).upsert({ receipt_id: r.id, path, filename: slip.pdfName, mime: "application/pdf", size: slip.pdf.length, source: "mail" }, { onConflict: "path" });
      }
    }
  });
  return saved;
}

/**
 * Copies of one file on one receipt or expense — what the unstable attachment
 * ids left behind before v1.16.1 — removed, the first one kept. Mail files only.
 */
export async function removeDocCopies(sb: SupabaseClient, docs: { id: string; path: string; owner: string; filename: string; size: number }[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const extra = docs.filter((d) => {
    const k = `${d.owner}|${d.filename}|${d.size}`;
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  if (!extra.length) return new Set();
  const rm = await sb.storage.from(DOCS_BUCKET).remove(extra.map((d) => d.path));
  if (rm.error) return new Set();
  const del = await sb.from(DOCS).delete().in("id", extra.map((d) => d.id));
  return del.error ? new Set() : new Set(extra.map((d) => d.id));
}

/** Scan every connected mailbox that isn't revoked. */
export async function scanMail(sb: SupabaseClient): Promise<ScanResult[]> {
  if (!mailConfigured()) throw Object.assign(new Error("Mail scanning needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and FINANCE_MAIL_TOKEN_KEY in this Vercel project."), { status: 503 });
  const [accounts, vendors] = await Promise.all([
    fetchAll<Row>(sb, ACCOUNTS, "*", (q) => q.neq("status", "revoked")),
    vendorsOf(sb),
  ]);
  return Promise.all(accounts.map((a) => scanAccount(sb, a, vendors)));
}

/** Mailboxes for Settings and the pane — never the token. Null when 0015 hasn't been run. */
export async function mailAccounts(sb: SupabaseClient): Promise<{ email: string; status: string; lastError: string | null; lastScanAt: string | null; kept: number }[] | null> {
  const res = await sb.from(ACCOUNTS).select("email, status, last_error, last_scan_at").order("connected_at");
  if (res.error) return null;
  const counts = new Map<unknown, number>();
  for (const c of await fetchAll<Row>(sb, TOOL_MAIL, "account_email").catch(() => [] as Row[])) counts.set(c.account_email, (counts.get(c.account_email) ?? 0) + 1);
  return (res.data as Row[]).map((a) => ({
    email: String(a.email),
    status: String(a.status),
    lastError: (a.last_error as string | null) ?? null,
    lastScanAt: (a.last_scan_at as string | null) ?? null,
    kept: counts.get(a.email) ?? 0,
  }));
}
