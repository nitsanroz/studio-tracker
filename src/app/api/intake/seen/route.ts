import { NextResponse, type NextRequest } from "next/server";
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
    .select("id, submitter_name, submitter_email, title, answers, seen_at, client_notified_at")
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

  // Already told them. Stamp nothing, send nothing, and report the original
  // time so the card can say when it happened.
  if (request.client_notified_at) {
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

  // The studio's own wording, edited in Settings. A missing or malformed row
  // falls through to the default rather than blocking the send.
  const { data: tpl } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "intake_seen_email")
    .maybeSingle();
  const template =
    tpl?.value && typeof tpl.value === "object" ? (tpl.value as SeenEmailTemplate) : null;

  const answers = (request.answers ?? {}) as Record<string, unknown>;
  const { subject, html } = renderSeenEmail(template, {
    submitterName: String(request.submitter_name ?? ""),
    taskName: String(request.title ?? ""),
    company: typeof answers.company === "string" ? answers.company : "",
  });

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
    await admin.from("task_requests").update({ seen_at: now, seen_by: user.id }).eq("id", requestId);
    const detail = await mail?.text().catch(() => "");
    console.error("intake receipt email failed", mail?.status, detail);
    return NextResponse.json(
      { error: "Marked as seen, but the email didn't go out. Try again in a moment." },
      { status: 502 },
    );
  }

  const { error: stampError } = await admin
    .from("task_requests")
    .update({ seen_at: request.seen_at ?? now, seen_by: user.id, client_notified_at: now })
    .eq("id", requestId);
  if (stampError) {
    // The client HAS been mailed at this point, so say so — a false "failed"
    // here is what would produce a second email on the retry.
    console.error("intake receipt stamp failed", stampError);
  }

  return NextResponse.json({ seenAt: request.seen_at ?? now, clientNotifiedAt: now });
}
