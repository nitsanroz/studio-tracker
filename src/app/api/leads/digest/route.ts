import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { service } from "@/lib/gmail/sync";
import { boardUrl, esc, leadUrl, recipients, sendMail } from "@/lib/leads/mail";
import { mapStage } from "@/lib/leads/stage-map";
import { isStalled } from "@/lib/leads/stalled";
import type { Lead } from "@/lib/leads/types";

export const maxDuration = 60;

/**
 * The morning email: replies owed, next steps due, stage suggestions waiting,
 * leads gone quiet. Vercel cron, Sun–Thu at 04:00 UTC (07:00 Israel in winter,
 * 07:00/08:00 around DST — close enough for a morning list).
 *
 * ⚠️ NOTHING TO SAY, NOTHING SENT. A digest that arrives every morning saying
 * "all clear" is a digest people stop opening.
 *
 * `?preview=1` with the cron secret returns the HTML instead of sending it.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const want = `Bearer ${secret}`;
  const got = req.headers.get("authorization") ?? "";
  return secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sb = service();
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);

  const [{ data: stageRows }, { data: leadRows }, { data: owed }, { data: sugg }] = await Promise.all([
    sb.from("lead_stages").select("id,name,position,kind,stall_days,rule_key"),
    sb
      .from("leads")
      .select("id,company,stage_id,next_step,next_step_due,last_activity_at,stage_changed_at")
      .is("deleted_at", null),
    sb.from("lead_threads").select("lead_id,last_message_at").eq("reply_owed_by", "us"),
    sb.from("lead_suggestions").select("lead_id,reason,to_stage_id").eq("status", "pending"),
  ]);
  const stages = ((stageRows ?? []) as Row[]).map(mapStage);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const open = ((leadRows ?? []) as Row[]).filter((l) => {
    const s = l.stage_id ? stageById.get(String(l.stage_id)) : undefined;
    return !s || s.kind === "open";
  });
  const company = new Map(open.map((l) => [String(l.id), String(l.company)]));

  const owedSince = new Map<string, string>();
  for (const t of (owed ?? []) as Row[]) {
    const id = String(t.lead_id);
    const at = String(t.last_message_at ?? "");
    if (company.has(id) && at && (!owedSince.has(id) || at < owedSince.get(id)!)) owedSince.set(id, at);
  }
  const replies = [...owedSince.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const due = open
    .filter((l) => l.next_step && l.next_step_due && String(l.next_step_due) <= today)
    .sort((a, b) => String(a.next_step_due).localeCompare(String(b.next_step_due)));
  const suggestions = ((sugg ?? []) as Row[]).filter((s) => company.has(String(s.lead_id)));
  const stalled = open.filter((l) =>
    isStalled(
      { lastActivityAt: String(l.last_activity_at), stageChangedAt: String(l.stage_changed_at) } as Lead,
      l.stage_id ? stageById.get(String(l.stage_id)) : undefined,
      now,
    ),
  );

  const total = replies.length + due.length + suggestions.length;
  const d = (iso: string) => {
    const [y, m, dd] = iso.slice(0, 10).split("-");
    return `${Number(dd)}/${Number(m)}/${y.slice(2)}`;
  };
  const a = (id: string, label: string) =>
    `<a href="${leadUrl(id)}" style="color:#0b43ed;text-decoration:none"><b>${esc(label)}</b></a>`;
  const section = (title: string, items: string[]) =>
    items.length
      ? `<h3 style="margin:18px 0 6px;font-size:14px">${title} · ${items.length}</h3><ul style="margin:0;padding-left:18px">${items.map((i) => `<li style="margin:3px 0">${i}</li>`).join("")}</ul>`
      : "";

  const html =
    `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#06112f">` +
    section("Replies we owe", replies.map(([id, at]) => `${a(id, company.get(id)!)} — waiting since ${d(at)}`)) +
    section(
      "Next steps due",
      due.map((l) => `${a(String(l.id), String(l.company))} — ${esc(String(l.next_step))} · due ${d(String(l.next_step_due))}`),
    ) +
    section(
      "Suggestions to accept or dismiss",
      suggestions.map(
        (s) =>
          `${a(String(s.lead_id), company.get(String(s.lead_id))!)} → ${esc(stageById.get(String(s.to_stage_id))?.name ?? "?")}: ${esc(String(s.reason))}`,
      ),
    ) +
    (stalled.length ? `<p style="margin-top:16px;color:#8a5a09">${stalled.length} open lead${stalled.length === 1 ? " has" : "s have"} gone quiet.</p>` : "") +
    `<p style="margin-top:18px"><a href="${boardUrl()}">Open Leads → Today</a></p></div>`;

  if (req.nextUrl.searchParams.get("preview") === "1") {
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  // Fri/Sat are the studio's weekend (the cron already skips them; a manual call respects it too).
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(now);
  if (weekday === "Fri" || weekday === "Sat") return NextResponse.json({ skipped: "weekend" });
  if (total === 0) return NextResponse.json({ skipped: "nothing to report" });

  const to = await recipients(sb, "digest_recipients");
  const ok = await sendMail(to, `Leads today: ${total} thing${total === 1 ? "" : "s"} waiting`, html);
  return NextResponse.json({ sent: ok, to: to.length, total });
}
