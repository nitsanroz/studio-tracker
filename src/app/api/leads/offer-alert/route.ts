import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/gmail/auth";
import { service } from "@/lib/gmail/sync";
import { formatMoney } from "@/lib/leads/fx";
import { esc, leadUrl, recipients, sendMail } from "@/lib/leads/mail";

/**
 * "An offer is waiting for your review" (PRD US17) — mailed to the approvers
 * (Settings → Leads; every admin by default) when an offer is put In review.
 *
 * ⚠️ ONCE PER OFFER: `review_alerted_at` (0044) is stamped on the first send,
 * so flipping the status back and forth cannot become a stream of mail.
 * ⚠️ The person who put it in review is left off — they know already.
 */
export async function POST(req: NextRequest) {
  const who = await requireAdmin();
  if ("response" in who) return who.response;
  const body = (await req.json().catch(() => null)) as { offerId?: unknown } | null;
  const offerId = typeof body?.offerId === "string" ? body.offerId : "";
  if (!/^[0-9a-f-]{36}$/i.test(offerId)) return NextResponse.json({ error: "No offer" }, { status: 400 });

  const sb = service();
  const { data: offer } = await sb
    .from("lead_offers")
    .select("id,lead_id,version,amount,currency,status,scope_summary,review_alerted_at,approved_at,leads(company)")
    .eq("id", offerId)
    .maybeSingle();
  const o = offer as
    | {
        lead_id: string;
        version: number;
        amount: number | null;
        currency: "ILS" | "USD";
        status: string;
        scope_summary: string | null;
        review_alerted_at: string | null;
        approved_at: string | null;
        leads: { company: string } | null;
      }
    | null;
  if (!o || o.status !== "in_review" || o.review_alerted_at || o.approved_at) {
    return NextResponse.json({ sent: false });
  }

  const { data: me } = await sb.auth.admin.getUserById(who.userId);
  const mine = me?.user?.email?.toLowerCase();
  const to = (await recipients(sb, "approver_ids")).filter((e) => e.toLowerCase() !== mine);
  const company = o.leads?.company ?? "A lead";
  // ⚠️ Claim before sending: two in-review flips at once both passed the
  // `review_alerted_at` check above and mailed the approvers twice. Only the
  // request whose stamp lands sends; a failed send gives the claim back.
  const stamp = new Date().toISOString();
  const { data: claimed } = await sb
    .from("lead_offers")
    .update({ review_alerted_at: stamp })
    .eq("id", offerId)
    .is("review_alerted_at", null)
    .select("id");
  if (!claimed?.length) return NextResponse.json({ sent: false });
  const ok = await sendMail(
    to,
    `Offer to review: ${company} v${o.version}`,
    `<p><b>${esc(company)}</b> — offer v${o.version}${o.amount !== null ? `, ${esc(formatMoney(Number(o.amount), o.currency))}` : ""}, is waiting for your review.</p>` +
      (o.scope_summary ? `<p style="white-space:pre-wrap;color:#555">${esc(o.scope_summary)}</p>` : "") +
      `<p><a href="${leadUrl(o.lead_id)}">Open the lead → Offers</a></p>`,
  );
  if (!ok) await sb.from("lead_offers").update({ review_alerted_at: null }).eq("id", offerId).eq("review_alerted_at", stamp);
  return NextResponse.json({ sent: ok, to: to.length });
}
