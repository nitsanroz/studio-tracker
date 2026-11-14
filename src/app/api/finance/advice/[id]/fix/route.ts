import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { ITEMS, studioToday } from "@/lib/finance/advice/run";
import type { Fix } from "@/lib/finance/advice/signals";
import { amountFieldsOf } from "@/lib/finance/amount-vat";
import { fetchAll } from "@/lib/finance/db";
import { buildFxTable, type FxRow } from "@/lib/finance/fx";

/**
 * A card's one-click fix (v1.13.0, Nitsan 2026-11-05: "be proactive — offer
 * me to update it"). POST makes the change the card describes; POST with
 * `{ undo }` puts back what it changed (the notice's Undo).
 *
 * ⚠️ The fix is read from the STORED item, never from the request, and
 * checked again here: only Expenses rows of the card's own vendor, monthly or
 * yearly, never `final`; only renewals dated after today are removed; a new
 * price (`add`) is a copy of the card's own row, dated after it, added once —
 * its ₪ net worked out here from that month's rate. The
 * owner can edit Expenses anyway — this guards against a stale card, not a
 * stranger (ownerOnly does that).
 */
type ExpenseRow = Record<string, unknown> & { id: string; date: string; vendor: string; category: string; state: string; end_date: string | null };
const COLS = "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state, filed_at";
const canon = (s: unknown) => String(s ?? "").trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseFix(raw: unknown): Fix | null {
  if (typeof raw !== "string") return null;
  try {
    const f = JSON.parse(raw) as Fix;
    const ids = (f.remove ?? []).every((x) => typeof x === "string");
    const ends = (f.end ?? []).every((e) => typeof e?.id === "string" && DAY.test(e.date));
    const add = !f.add || (typeof f.add.like === "string" && DAY.test(f.add.date) && Number(f.add.amount) > 0 && typeof f.add.description === "string");
    return ids && ends && add && typeof f.label === "string" ? f : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const sb = auth.sb;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { undo?: ExpenseRow[]; added?: string };

  const { data: item, error } = await sb.from(ITEMS).select("id, facts").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const facts = (item.facts ?? {}) as Record<string, unknown>;
  const fix = parseFix(facts.fix);
  if (!fix) return NextResponse.json({ error: "This card has nothing to fix." }, { status: 400 });
  const vendor = canon(facts.vendor);
  const ids = [...new Set([...(fix.remove ?? []), ...(fix.end ?? []).map((e) => e.id), ...(fix.add ? [fix.add.like] : [])])];
  const fits = (r: { vendor: unknown; category: unknown; state: unknown }) =>
    canon(r.vendor) === vendor && (r.category === "monthly" || r.category === "yearly") && r.state !== "final";

  // Undo: the rows exactly as they were — only the ones this fix touched.
  if (body.undo) {
    const back = body.undo.filter((r) => ids.includes(String(r?.id)) && fits(r));
    if (back.length !== body.undo.length) return NextResponse.json({ error: "That isn't what this card changed." }, { status: 400 });
    // The row the fix added goes again — only that one: this vendor, the fix's own date, never final.
    if (body.added) {
      if (!fix.add) return NextResponse.json({ error: "That isn't what this card changed." }, { status: 400 });
      const { data: added } = await sb.from("finance_expenses").select(COLS).eq("id", body.added).maybeSingle();
      if (added) {
        const a = added as ExpenseRow;
        if (!fits(a) || a.date !== fix.add.date) return NextResponse.json({ error: "That isn't what this card changed." }, { status: 400 });
        const del = await sb.from("finance_expenses").delete().eq("id", a.id);
        if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
      }
    }
    if (back.length) {
      const put = await sb.from("finance_expenses").upsert(back, { onConflict: "id" });
      if (put.error) return NextResponse.json({ error: put.error.message }, { status: 500 });
    }
    await sb.from(ITEMS).update({ done_at: null, snoozed_until: null, snoozed_at_severity: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const { data: rows, error: readErr } = await sb.from("finance_expenses").select(COLS).in("id", ids);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const before = (rows ?? []) as ExpenseRow[];
  const today = studioToday();
  const byId = new Map(before.map((r) => [r.id, r]));
  const stale = ids.some((x) => !byId.get(x) || !fits(byId.get(x)!)) || (fix.remove ?? []).some((x) => byId.get(x)!.date <= today);
  const like = fix.add ? byId.get(fix.add.like) : undefined;
  const addStale = !!fix.add && (!like || like.category !== "monthly" || fix.add.date <= like.date || (!!like.end_date && like.end_date < fix.add.date));
  if (stale || addStale) return NextResponse.json({ error: "Expenses changed since this card was made — open Expenses to check." }, { status: 409 });

  // The new price's row, worked out before anything is written.
  let newRow: Record<string, unknown> | null = null;
  if (fix.add && like) {
    const already = await sb.from("finance_expenses").select("id").eq("vendor", like.vendor).eq("category", "monthly").eq("date", fix.add.date).eq("amount_gross", fix.add.amount).limit(1);
    if (already.data?.length) return NextResponse.json({ error: "That price is already on Expenses — open Expenses to check." }, { status: 409 });
    const fx = buildFxTable(await fetchAll<FxRow>(sb, "fx_rates", "year, month, usd_ils, eur_ils"));
    const currency = String(like.currency);
    const fields = amountFieldsOf({ amount: String(fix.add.amount), currency, withVat: currency === "ILS" && !!like.vat_included }, fix.add.date, fx);
    if (!fields) return NextResponse.json({ error: "Couldn't work out the new amount." }, { status: 400 });
    newRow = {
      date: fix.add.date,
      category: "monthly",
      vendor: like.vendor,
      description: fix.add.description,
      recurrence: like.recurrence ?? "monthly",
      link: like.link ?? null,
      notes: "",
      state: "actual",
      ...fields,
    };
  }

  // ⚠️ All or nothing (there's no transaction from here): one failed write used to leave the rest
  // done with no `before` sent back, so no Undo. Now the steps run easiest-to-reverse first — the
  // new row (deleted by id), the end dates (each row's own end_date back) — and the removals last;
  // any failure puts back what was already written before answering.
  let added: string | null = null;
  const ended: string[] = [];
  const rollBack = async (why: string) => {
    const left: string[] = [];
    if (added) {
      const del = await sb.from("finance_expenses").delete().eq("id", added);
      if (del.error) left.push("the new price's row");
    }
    for (const rid of ended) {
      const upd = await sb.from("finance_expenses").update({ end_date: byId.get(rid)!.end_date }).eq("id", rid);
      if (upd.error) left.push(`${byId.get(rid)!.vendor}'s end date`);
    }
    const tail = left.length ? ` Couldn't put back ${left.join(" and ")} — open Expenses to check.` : " Nothing was changed.";
    return NextResponse.json({ error: why + tail }, { status: 500 });
  };
  if (newRow) {
    const ins = await sb.from("finance_expenses").insert(newRow).select("id").single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    added = String(ins.data.id);
  }
  for (const e of fix.end ?? []) {
    const upd = await sb.from("finance_expenses").update({ end_date: e.date }).eq("id", e.id);
    if (upd.error) return rollBack(upd.error.message);
    ended.push(e.id);
  }
  if (fix.remove?.length) {
    const del = await sb.from("finance_expenses").delete().in("id", fix.remove);
    if (del.error) return rollBack(del.error.message);
  }
  await sb.from(ITEMS).update({ done_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true, done: fix.done, before, added });
}
