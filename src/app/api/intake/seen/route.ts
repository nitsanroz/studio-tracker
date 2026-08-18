import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, isMissingSchema } from "@/lib/db";
import { needsReview } from "@/lib/brief-diff";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { renderSeenEmail, type SeenEmailTemplate } from "@/lib/brief";

/**
 * "Someone at the studio has read your brief" — the receipt an admin sends a
 * client from the Intake Queue (migration 0028).
 *
 * A route rather than a store write, for two reasons the browser can't cover:
 *
 *  1. `RESEND_API_KEY` is server-only, and must stay that way. Prefixing it
 *     NEXT_PUBLIC_ to send from the client would hand the studio's whole
 *     transactional-mail account to anyone who opened devtools.
 *  2. The send-once guarantee needs the check and the stamp in one place. This
 *     reads `client_notified_at` and writes it in the same request, so a double
 *     click — or two admins opening the queue at once — cannot mail a client
 *     the same acknowledgement twice.
 *
 * ⚠️ Mail goes to a REAL CLIENT ADDRESS. That is why nothing here fires on its
 * own: the queue page has an explicit button, and this route is only ever
 * reached by an admin clicking it.
 */

export const dynamic = "force-dynamic";

/**
 * Writes an acknowledgement, with the 0030 columns if the schema has them.
 *
 * ⚠️ `answers_ack`/`acked_at` are the baseline a later client revision is diffed
 * against, and they are worth having — but never at the cost of the write they
 * ride along with. A missing column on a WRITE comes back as **PGRST204**, not
 * the `42703` a SELECT raises, so a fallback keyed on the select code silently
 * never fires: that is exactly how every intake submission 500'd while 0029 was
 * pending (v1.19.4). One retry without the snapshot, and only for that error.
 */
async function ackUpdate(
  admin: SupabaseClient,
  requestId: string,
  fields: Record<string, unknown>,
  answers: unknown,
  now: string,
) {
  const { error } = await admin
    .from("task_requests")
    .update({ ...fields, answers_ack: answers ?? {}, acked_at: now })
    .eq("id", requestId);
  if (!error) return;
  if (!isMissingSchema(new DbError("task_requests", error.message, error.code))) {
    console.error("intake ack failed", error);
    return;
  }
  if (!Object.keys(fields).length) return; // nothing left to write
  const { error: retry } = await admin.from("task_requests").update(fields).eq("id", requestId);
  if (retry) console.error("intake ack retry failed", retry);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { requestId } = (await req.json().catch(() => ({}))) as { requestId?: string };
  if (!requestId) return NextResponse.json({ error: "Missing requestId" }, { status: 400 });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: request, error } = await admin
    .from("task_requests")
    .select("id, submitter_name, submitter_email, title, answers, seen_at, client_notified_at, edited_at, acked_at")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) {
    // The most likely cause by far is 0028 not having been applied yet — the
    // columns are in the select list, so PostgREST rejects the whole query.
    return NextResponse.json(
      { error: error?.message ?? "That submission no longer exists." },
      { status: error ? 500 : 404 },
    );
  }

  const now = new Date().toISOString();

  /**
   * Already told them about THIS version. Stamp nothing, send nothing, and
   * report the original time so the card can say when it happened.
   *
   * ⚠️ "This version" is the part that changed in v1.19.5. The guard used to be
   * `client_notified_at` alone, which is right for a brief nobody has touched —
   * a double click, or two admins in the queue at once, must not mail the same
   * acknowledgement twice. But a client who has since CHANGED the brief is
   * waiting to hear that the change landed, and the old test would have refused
   * that second, different email forever. So a revision the studio hasn't
   * acknowledged yet may be acknowledged again; anything else still cannot.
   */
  const unacknowledgedEdit = needsReview({
    editedAt: request.edited_at ?? null,
    ackedAt: request.acked_at ?? null,
  });
  if (request.client_notified_at && !unacknowledgedEdit) {
    return NextResponse.json({
      seenAt: request.seen_at ?? request.client_notified_at,
      clientNotifiedAt: request.client_notified_at,
      alreadySent: true,
    });
  }

  const to = String(request.submitter_email ?? "").trim();
  if (!to || !to.includes("@")) {
    return NextResponse.json(
      { error: "That submission has no email address to reply to." },
      { status: 422 },
    );
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email isn't configured (RESEND_API_KEY)." }, { status: 503 });
  }

  /**
   * ⚠️ WHICH receipt this is. A brief the client has changed since the studio
   * last acknowledged it gets the UPDATE wording — Nitsan's ask, and the honest
   * message: "your changes reached us", not "your brief reached us", which for a
   * job already under way reads as though nobody noticed the change.
   *
   * `needsReview` is the same test the queue badge uses, so the email and the
   * screen can never disagree about whether this is an update.
   */
  const isUpdate = unacknowledgedEdit;

  // The studio's own wording, edited in Settings. A missing or malformed row
  // falls through to the matching default rather than blocking the send.
  const { data: tpl } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", isUpdate ? "intake_seen_update_email" : "intake_seen_email")
    .maybeSingle();
  const template =
    tpl?.value && typeof tpl.value === "object" ? (tpl.value as SeenEmailTemplate) : null;

  const answers = (request.answers ?? {}) as Record<string, unknown>;
  const { subject, html } = renderSeenEmail(
    template,
    {
      submitterName: String(request.submitter_name ?? ""),
      taskName: String(request.title ?? ""),
      company: typeof answers.company === "string" ? answers.company : "",
    },
    isUpdate ? "update" : "new",
  );

  const mail = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.INTAKE_FROM_EMAIL || "Studio&more <onboarding@resend.dev>",
      to: [to],
      // ⚠️ Replies belong to a person, not to the notifications mailbox — a
      // client answering this should reach whoever is handling their brief.
      reply_to: user.email ? [user.email] : undefined,
      subject,
      html,
    }),
  }).catch(() => null);

  if (!mail?.ok) {
    // ⚠️ `seen_at` is still stamped. The admin DID read it, and leaving the row
    // untouched because a mail server was down would make the queue lie about
    // what has been looked at. `client_notified_at` stays null, so the button
    // is still there to try again.
    // ⚠️ Snapshots the answers being acknowledged (0030). This is the baseline a
    // later revision is diffed against — "what changed since you read it" only
    // means anything if we recorded what you read.
    //
    // ⚠️ One rung down if 0030 isn't applied, or marking a brief seen would fail
    // outright. A missing column on a WRITE reports `PGRST204`, NOT the `42703`
    // a select raises — the trap that took the intake form down in v1.19.4.
    await ackUpdate(admin, requestId, { seen_at: now, seen_by: user.id }, request.answers, now);
    const detail = await mail?.text().catch(() => "");
    console.error("intake receipt email failed", mail?.status, detail);
    return NextResponse.json(
      { error: "Marked as seen, but the email didn't go out. Try again in a moment." },
      { status: 502 },
    );
  }

  const { error: stampError } = await admin
    .from("task_requests")
    .update({
      seen_at: request.seen_at ?? now,
      seen_by: user.id,
      client_notified_at: now,
    })
    .eq("id", requestId);
  if (stampError) {
    // The client HAS been mailed at this point, so say so — a false "failed"
    // here is what would produce a second email on the retry.
    console.error("intake receipt stamp failed", stampError);
  }
  // Best-effort baseline, separate from the stamp above so a missing 0030 can
  // never cost the receipt itself.
  await ackUpdate(admin, requestId, {}, request.answers, now);

  return NextResponse.json({ seenAt: request.seen_at ?? now, clientNotifiedAt: now });
}
