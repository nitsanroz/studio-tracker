"use client";

// Documents on expenses, from the browser (v1.16.0, Nitsan 2026-11-06:
// "preview and download them"). The private `finance-docs` bucket and the
// `finance_documents` table (reference/0019) are open under RLS to everyone on
// Expenses since reference/0022 (v1.18.0), whose own session reads, adds and
// removes them — no server key.
// Files are opened through signed links that expire in a few minutes.

import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll } from "@/lib/finance/db";
import { cleanItem, goodItem, receiptDetails, storageName, type DocRef } from "@/lib/finance/mail/receipts";

const DOCS_BUCKET = "finance-docs";
const DOCS = "finance_documents";
/** The bucket's own limit (reference/0019). */
const MAX_UPLOAD = 15 * 1024 * 1024;

type DocRow = DocRef & { path: string };

async function rowOf(id: string): Promise<DocRow | null> {
  const { data } = await createClient().from(DOCS).select("id, path, filename, mime, size").eq("id", id).maybeSingle();
  return (data as DocRow | null) ?? null;
}

/** A link to the file that works for a few minutes — to show it, or (download) to save it under its own name. */
export async function docUrl(id: string, download = false): Promise<string | null> {
  const row = await rowOf(id);
  if (!row) return null;
  const { data } = await createClient()
    .storage.from(DOCS_BUCKET)
    .createSignedUrl(row.path, 300, download ? { download: row.filename } : undefined);
  return data?.signedUrl ?? null;
}

/** A receipt email put on an expense (added from the list, or one the row already covered — v1.22.0). */
export interface RowReceipt {
  id: string;
  /** the email's day */
  date: string;
  amount: number | null;
  currency: string | null;
  /** where to get the invoice: the email's own link, else the email in Gmail */
  link: string;
  /** what the receipt read (v1.23.0): its invoice number, card and what was bought */
  invoiceNumber: string | null;
  paidWith: string | null;
  item: string | null;
}

/** The month a file is for: the receipt it came with, the month it was added under (in its path), else when it was saved. */
const UPLOAD_MONTH = /^expense\/[^/]+\/(\d{4}-\d{2})\//;
export const monthOfPath = (path: string) => UPLOAD_MONTH.exec(path)?.[1] ?? null;

type ReceiptRow = {
  id: string;
  expense_id: string;
  sent_at: string;
  amount: number | null;
  currency: string | null;
  invoice_url?: string | null;
  account_email: string;
  gmail_message_id: string;
  invoice_number?: string | null;
  paid_with?: string | null;
  item_description?: string | null;
  subject?: string | null;
};

async function receiptsOf(expenseIds: string[]): Promise<ReceiptRow[]> {
  const sb = createClient();
  const out: ReceiptRow[] = [];
  // Newest schema first: the invoice link (0021), what was bought (0020), number and card (0018).
  const base = "id, expense_id, sent_at, subject, amount, currency, account_email, gmail_message_id";
  const shapes = [`${base}, invoice_number, paid_with, item_description, invoice_url`, `${base}, invoice_number, paid_with`, base];
  for (let i = 0; i < expenseIds.length; i += 200) {
    const ids = expenseIds.slice(i, i + 200);
    // ⚠️ Paged (`fetchAll`): a monthly row carries one "added" receipt a month, so 200 expenses can
    // hold more than the 1000 rows a single select silently stops at.
    let rows: ReceiptRow[] | null = null;
    for (const cols of shapes) {
      try {
        rows = await fetchAll<ReceiptRow>(sb, "finance_mail_receipts", cols, (q) => q.eq("status", "added").in("expense_id", ids));
        break;
      } catch {
        // an older schema: try the next, smaller column list
      }
    }
    if (!rows) return out;
    out.push(...rows);
  }
  return out;
}

/**
 * Each expense's documents, or null when the table isn't there (0019 not run)
 * or this user can't see it — each with the month it's for — and the receipt
 * emails put on each expense. Copies of one mail file on one expense — left by
 * v1.16.0, which saved some receipts' files three times — are removed here,
 * the first one kept (v1.16.1).
 */
export async function docsFor(expenseIds: string[]): Promise<{ docs: Map<string, DocRef[]>; receipts: Map<string, RowReceipt[]> } | null> {
  const sb = createClient();
  const out = new Map<string, DocRef[]>();
  const copies: DocRow[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < expenseIds.length; i += 200) chunks.push(expenseIds.slice(i, i + 200));
  // The chunks load together; read in order below, so "the first copy kept" still means the same one.
  const [recs, results] = await Promise.all([
    receiptsOf(expenseIds).catch(() => []),
    Promise.all(chunks.map((ids) => sb.from(DOCS).select("id, expense_id, receipt_id, path, filename, mime, size, source, created_at").in("expense_id", ids).order("created_at"))),
  ]);
  const dayOf = new Map(recs.map((r) => [r.id, String(r.sent_at).slice(0, 10)]));
  for (const { data, error } of results) {
    // A missing table (0019 not run) or no access fails the first chunk like any other.
    if (error) return null;
    for (const d of data as (DocRow & { expense_id: string; receipt_id: string | null; source: string; created_at: string })[]) {
      const mine = out.get(d.expense_id) ?? [];
      if (d.source === "mail" && mine.some((x) => x.filename === d.filename && x.size === d.size)) {
        copies.push(d);
        continue;
      }
      const month = (d.receipt_id ? dayOf.get(d.receipt_id)?.slice(0, 7) : null) ?? monthOfPath(d.path) ?? String(d.created_at).slice(0, 7);
      out.set(d.expense_id, [...mine, { id: d.id, filename: d.filename, mime: d.mime, size: d.size, fromMail: d.source === "mail", month }]);
    }
  }
  if (copies.length) {
    const rm = await sb.storage.from(DOCS_BUCKET).remove(copies.map((c) => c.path));
    if (!rm.error) await sb.from(DOCS).delete().in("id", copies.map((c) => c.id));
  }
  const receipts = new Map<string, RowReceipt[]>();
  for (const r of recs) {
    const link =
      typeof r.invoice_url === "string" && r.invoice_url.startsWith("https://")
        ? r.invoice_url
        : `https://mail.google.com/mail/?authuser=${encodeURIComponent(r.account_email)}#all/${r.gmail_message_id}`;
    const line: RowReceipt = {
      id: r.id,
      date: String(r.sent_at).slice(0, 10),
      amount: r.amount == null ? null : Number(r.amount),
      currency: r.currency,
      link,
      // Read before "חשבונית מרכזת - SI…" was a label: the subject still has the number.
      invoiceNumber: r.invoice_number?.trim() || receiptDetails("", r.subject ?? "").invoice,
      paidWith: r.paid_with?.trim() || null,
      item: r.item_description && goodItem(cleanItem(r.item_description)) ? cleanItem(r.item_description) : null,
    };
    receipts.set(r.expense_id, [...(receipts.get(r.expense_id) ?? []), line]);
  }
  return { docs: out, receipts };
}

/** Add a file to an expense — for `month` ("YYYY-MM") on a Monthly row. Returns an error to show, or null. */
export async function uploadDoc(expenseId: string, file: File, month?: string): Promise<string | null> {
  if (file.size > MAX_UPLOAD) return "That file is over 15 MB.";
  const sb = createClient();
  // ASCII only — Storage refuses a Hebrew key (v1.24.2); the real name is kept in the table.
  const safe = storageName(file.name);
  const path = `expense/${expenseId}/${month && /^\d{4}-\d{2}$/.test(month) ? `${month}/` : ""}${Date.now()}-${safe}`;
  const up = await sb.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) return up.error.message;
  const ins = await sb.from(DOCS).insert({ expense_id: expenseId, path, filename: file.name, mime: file.type || null, size: file.size, source: "upload" });
  if (ins.error) {
    await sb.storage.from(DOCS_BUCKET).remove([path]);
    return ins.error.message;
  }
  return null;
}

/** Remove a file for good — from the bucket and the list. */
export async function removeDoc(id: string): Promise<string | null> {
  const row = await rowOf(id);
  if (!row) return "Not found.";
  const sb = createClient();
  const rm = await sb.storage.from(DOCS_BUCKET).remove([row.path]);
  if (rm.error) return rm.error.message;
  const del = await sb.from(DOCS).delete().eq("id", id);
  return del.error?.message ?? null;
}
