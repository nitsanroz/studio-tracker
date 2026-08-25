import { NextResponse, type NextRequest } from "next/server";
import { DbError, isMissingSchema } from "@/lib/db";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  assembleEmailHtml,
  assembleTaskBrief,
  parseBudgetHours,
  type BriefLink,
  type Deliverable,
  type IntakeAnswers,
  type IntakeFile,
} from "@/lib/brief";
import { kindById } from "@/lib/intake-fields";
import { hostLabel, normalizeUrl } from "@/lib/links";
import { appOrigin } from "@/lib/app-origin";
import {
  MAX_INTAKE_BYTES,
  MAX_INTAKE_FILES,
  MAX_INTAKE_TOTAL_BYTES,
  classifyUpload,
  formatSize,
} from "@/lib/uploads";

// Anti-flood: max submissions accepted per intake link within the window.
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX = 8;

// Titled links the client added with "+ Add link" on the form. Same cap as
// uploads — this is an unauthenticated endpoint, so every list it accepts needs
// a ceiling that isn't "whatever was posted".
const MAX_LINKS = 8;
const MAX_LINK_TITLE = 120;

// Public endpoint for the client intake form. Token-gated; all DB access via
// the service key on the server (nothing is exposed to anonymous clients).

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

type IntakeLink = {
  id: string;
  client_id: string | null;
  active: boolean;
  clients: { name: string | null } | null;
};

async function resolveLink(token: string): Promise<IntakeLink | null> {
  const sb = admin();
  const { data } = await sb
    .from("intake_links")
    .select("id, client_id, active, clients(name)")
    .eq("token", token)
    .maybeSingle();
  return data && data.active ? (data as unknown as IntakeLink) : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  return NextResponse.json({
    clientName: link.clients?.name ?? null,
  });
}

/**
 * The kinds of work the client ticked.
 *
 * ⚠️ Validated against the real list rather than trusted. These decide which
 * questions count as "asked" when the notification reports what went
 * unanswered, and they arrive from an unauthenticated form. Anything unknown is
 * dropped, and an empty result makes `fieldsAsked` fall back to asking
 * everything — the safe direction, since it can only over-report gaps.
 */
function parseKinds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((k): k is string => typeof k === "string" && !!kindById(k)))];
}

/**
 * The client's named pieces, posted as one JSON field.
 *
 * ⚠️ Unlike the links, none of this is ever rendered as markup or an href — it
 * goes into the brief as plain text — so the risk here is size, not injection.
 * Bounded on both count and length, and every entry is re-checked rather than
 * cast: the payload is whatever the browser sent.
 */
function parseDeliverables(raw: string): Deliverable[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 10).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const g = (k: string, max: number) =>
      (typeof r[k] === "string" ? (r[k] as string) : "").trim().slice(0, max);
    const d = {
      name: g("name", 80),
      details: g("details", 2000),
      dimensions: g("dimensions", 120),
      format: g("format", 120),
    };
    return d.name || d.details || d.dimensions || d.format ? [d] : [];
  });
}

/**
 * The client's own "+ Add link" rows, posted as one JSON field.
 *
 * ⚠️ Every URL goes through `normalizeUrl`, exactly as the studio's own link
 * editor does — these become `href`s on an approved task where only the TITLE
 * is rendered, so a `javascript:` URL under a friendly title is something no
 * colleague could spot before clicking. Anything that isn't http/https/mailto
 * is dropped rather than stored and filtered later.
 */
function parseLinks(raw: string): BriefLink[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BriefLink[] = [];
  for (const row of parsed.slice(0, MAX_LINKS)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = normalizeUrl(typeof r.url === "string" ? r.url : "");
    if (!url) continue;
    const title = (typeof r.title === "string" ? r.title : "").trim().slice(0, MAX_LINK_TITLE);
    // An untitled link still beats a lost one: "docs.google.com" is at least
    // something a person can recognise.
    out.push({ title: title || hostLabel(url), url });
  }
  return out;
}

/**
 * The files the browser has ALREADY put in the bucket, posted as one JSON field
 * of `{path, name}` — never the bytes. Bounded and re-checked like every other
 * list this unauthenticated endpoint accepts; the path is verified against
 * storage by the caller, since anything here is only a claim.
 */
function parseUploaded(raw: string): { path: string; name: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { path: string; name: string }[] = [];
  for (const row of parsed.slice(0, MAX_INTAKE_FILES + 3)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const path = typeof r.path === "string" ? r.path.slice(0, 300) : "";
    const name = (typeof r.name === "string" ? r.name : "").slice(0, 200);
    if (path && name) out.push({ path, name });
  }
  return out;
}

/** Match "Company" text + email domain against client names. */
async function suggestClient(sb: ReturnType<typeof admin>, company: string, email: string) {
  const { data: clients } = await sb.from("clients").select("id, name").eq("archived", false);
  if (!clients) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = norm(company);
  const domain = norm(email.split("@")[1]?.split(".")[0] ?? "");
  let best: { id: string; score: number } | null = null;
  for (const cl of clients) {
    const n = norm(cl.name);
    let score = 0;
    if (c && (n === c || n.includes(c) || c.includes(n))) score = n === c ? 3 : 2;
    else if (domain && (n === domain || n.includes(domain) || domain.includes(n))) score = 1;
    if (score > (best?.score ?? 0)) best = { id: cl.id, score };
  }
  return best?.id ?? null;
}

/**
 * Tells the studio a brief arrived. Best-effort by design — the queue is the
 * record, and a mail server being down must not fail a client's submission.
 *
 * ⚠️ Shared by the new-brief and the EDIT path, with `updated` only changing the
 * subject. An edit has to notify too: an admin may have read the original
 * already, and a revision they never hear about is worse than no revision.
 */
async function notify(
  sb: ReturnType<typeof admin>,
  answers: IntakeAnswers,
  extras: { files: IntakeFile[]; links: BriefLink[]; dropped: string[] },
  updated: boolean,
) {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const { data: setting } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "intake_notify_emails")
      .maybeSingle();
    const recipients: string[] = Array.isArray(setting?.value) ? setting.value : [];
    if (!recipients.length) return;
    // ⚠️ NOT req.nextUrl.origin — see `appOrigin`. This route is
    // unauthenticated, so a forged Host header would put an attacker's URL
    // inside a real notification from the studio's own verified sender.
    const origin = appOrigin();
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.INTAKE_FROM_EMAIL || "Studio&more Tracker <onboarding@resend.dev>",
        to: recipients,
        subject: `${updated ? "Updated brief" : "New task"}: ${answers.taskName} — ${answers.company || answers.name}`,
        html: assembleEmailHtml(answers, extras, `${origin}/intake-queue`),
      }),
    });
  } catch (e) {
    console.error("intake email failed", e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const sb = admin();

  /**
   * Rate limit: cap accepted submissions per link per window (serverless-safe,
   * counted in the DB rather than in memory).
   *
   * ⚠️ COUNTS EDITS AS WELL AS NEW BRIEFS, and it did not. It counted rows
   * CREATED in the window, while an edit UPDATEs an existing row and returns
   * before any insert — so edits were never counted and nothing else bounded
   * them. Every edit sends a fresh "Updated brief" email to every address in
   * `intake_notify_emails`, so anyone holding their own `editId` + `editKey`
   * (which the client's browser keeps, by design) could loop it: unbounded mail
   * to the studio, Resend quota burned, and `seen_at` cleared each time so the
   * queue re-flagged the brief on every pass. Both actions now share one window.
   */
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count: recent, error: rateErr } = await sb
    .from("task_requests")
    .select("id", { count: "exact", head: true })
    .eq("intake_link_id", link.id)
    .or(`created_at.gte.${since},edited_at.gte.${since}`);
  /**
   * ⚠️ THIS FAILS OPEN, DELIBERATELY, AND THAT IS A JUDGEMENT CALL WORTH READING.
   *
   * The error used to be discarded entirely, so a failed count silently became
   * `0 >= 8` and the limiter was off with nothing said. It is now logged. It
   * still lets the submission through, because the alternative is worse HERE:
   * refusing costs a real client their brief, which is the exact failure this
   * whole area was rewritten to end (v1.19.2 — a client lost one and the studio
   * never knew it existed), and "a form that refuses to submit is a client who
   * phones instead". A spam window is recoverable; a lost brief is not.
   *
   * ⚠️ The UPLOAD route's cap makes the opposite call for the opposite reason —
   * a refused upload is retried in seconds and loses nothing.
   */
  if (rateErr) console.error("intake rate limit check failed — allowing", rateErr.message);
  if ((recent ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Too many submissions — please try again in a few minutes." },
      { status: 429 },
    );
  }

  const form = await req.formData();
  const f = (k: string) => String(form.get(k) ?? "").slice(0, 5000);

  const answers: IntakeAnswers = {
    name: f("name"),
    email: f("email"),
    company: f("company"),
    taskName: f("taskName"),
    dimensions: f("dimensions"),
    format: f("format"),
    animated: f("animated"),
    dueDate: f("dueDate"),
    budgetRange: f("budgetRange"),
    creativeBrief: f("creativeBrief"),
    goal: f("goal"),
    displayedWhere: f("displayedWhere"),
    targetAudience: f("targetAudience"),
    thingsToAvoid: f("thingsToAvoid"),
    content: f("content"),
    notes: f("notes"),
    scheduleMeeting: f("scheduleMeeting"),
    // ⚠️ Validated against the real list rather than trusted. This value decides
    // which questions count as "asked" when the brief reports what wasn't
    // answered, and it arrives from an unauthenticated form — an unknown id
    // falls back to "" and `fieldsAsked` then treats the submission as having
    // been asked everything, which is the safe direction.
    kinds: parseKinds(String(form.get("kinds") ?? "")),
    techNotes: f("techNotes"),
    deliverables: parseDeliverables(String(form.get("deliverables") ?? "")),
  };
  // ⚠️ These three, and no more. A brief with gaps still tells the studio
  // something, and the notification email reports what went unanswered — the
  // task brief deliberately does not. A form that refuses to submit is a client
  // who phones instead.
  if (!answers.name || !answers.email || !answers.taskName) {
    return NextResponse.json({ error: "Name, email and task name are required" }, { status: 400 });
  }

  const links = parseLinks(String(form.get("links") ?? ""));

  // Attachments.
  //
  // ⚠️ THE BYTES NO LONGER COME THROUGH HERE. The browser uploads each file
  // straight into the bucket with a signed URL from ./upload, and posts only the
  // PATHS — because a Vercel function refuses a request body over 4.5MB, which
  // silently cost a client a brief in v1.19.2. What arrives here is a claim, so
  // every path is re-checked against storage before it becomes an attachment.
  //
  // ⚠️ Every rejection is RECORDED, never a bare `continue`. A refused file that
  // vanishes leaves the client thanked and the studio reading a brief with no
  // hint an attachment was ever meant to exist — the silence this whole area was
  // rewritten to end.
  const files: IntakeFile[] = [];
  const dropped: string[] = [];
  const claimed = parseUploaded(String(form.get("uploaded") ?? ""));
  let stored = 0;
  for (const extra of claimed.slice(MAX_INTAKE_FILES)) {
    dropped.push(`${extra.name} — only ${MAX_INTAKE_FILES} files can be attached`);
  }
  for (const item of claimed.slice(0, MAX_INTAKE_FILES)) {
    // ⚠️ The path must sit under THIS link's own prefix. Without it a submission
    // could name any object in the bucket and attach another client's file to
    // its own brief — the whole reason ./upload namespaces what it mints.
    if (!item.path.startsWith(`${link.id}/`) || item.path.includes("..")) {
      dropped.push(`${item.name} — upload could not be verified`);
      continue;
    }
    // The object as STORAGE has it, not as the browser described it: its real
    // size and the type it was actually stored under.
    const slash = item.path.lastIndexOf("/");
    const { data: found } = await sb.storage
      .from("intake")
      .list(item.path.slice(0, slash), { search: item.path.slice(slash + 1), limit: 1 });
    const object = found?.[0];
    if (!object) {
      dropped.push(`${item.name} — the upload didn't finish`);
      continue;
    }
    const size = Number(object.metadata?.size ?? 0);
    const mime = String(object.metadata?.mimetype ?? "");
    if (size > MAX_INTAKE_BYTES) {
      dropped.push(`${item.name} — ${formatSize(size)}, over the ${formatSize(MAX_INTAKE_BYTES)} limit`);
      continue;
    }
    // ⚠️ Belt and braces behind the bucket's own `allowed_mime_types`. The route
    // used to FORCE a safe Content-Type on every upload; a browser writing
    // directly picks its own, and an `x.png` stored as `text/html` on a public
    // bucket on our domain is hosted XSS. The bucket refuses it first — this
    // catches a bucket whose config drifted.
    const expected = classifyUpload({ name: item.name } as File);
    if (!expected.ok || mime !== expected.contentType) {
      dropped.push(`${item.name} — unsupported file type`);
      continue;
    }
    // ⚠️ The per-brief total, weighed on what STORAGE says these objects are —
    // not on what the browser claimed when it asked for an upload URL. This is
    // the check that actually binds the budget.
    if (stored + size > MAX_INTAKE_TOTAL_BYTES) {
      dropped.push(
        `${item.name} — over the ${formatSize(MAX_INTAKE_TOTAL_BYTES)} total for one brief`,
      );
      continue;
    }
    stored += size;
    const { data: pub } = sb.storage.from("intake").getPublicUrl(item.path);
    files.push({ name: item.name, url: pub.publicUrl, size });
  }

  const clientId = link.client_id ?? null;
  const suggested = clientId ?? (await suggestClient(sb, answers.company, answers.email));
  // The SUBMISSION's brief lists files and links as text — the queue card and
  // the notification email are the only places anyone can reach them until the
  // request is approved. `approveRequest` rebuilds it without them, because by
  // then they are real rows in `links`.
  const brief = assembleTaskBrief(answers, { files, links, dropped });

  const row = {
    submitter_name: answers.name,
    submitter_email: answers.email,
    title: answers.taskName,
    brief,
    requested_due_date: answers.dueDate || null,
    client_approved_budget_hours: parseBudgetHours(answers.budgetRange),
    answers: { ...answers, files, links },
  };

  /**
   * An EDIT of a brief this same browser submitted, rather than a new one.
   *
   * ⚠️ Four things are checked, and each one is load-bearing on a form anybody
   * with the link can open: the key must match, the brief must belong to THIS
   * intake link (a key minted through one client's link must not reach another's
   * brief), the brief must still be `pending`, and `edited_at` is stamped so an
   * admin who has already read it is not left with silently stale text.
   *
   * ⚠️ `created_at`, `status`, `seen_at` and `client_notified_at` are deliberately
   * NOT touched. An edit is the client revising their own words, not a new
   * submission and not an undo of the studio having handled it.
   */
  const editId = String(form.get("editId") ?? "").slice(0, 64);
  const editKey = String(form.get("editKey") ?? "").slice(0, 128);
  if (editId && editKey) {
    const { data: existing } = await sb
      .from("task_requests")
      .select("id, status, intake_link_id, edit_key")
      .eq("id", editId)
      .maybeSingle();
    if (!existing || existing.edit_key !== editKey || existing.intake_link_id !== link.id) {
      return NextResponse.json({ error: "That brief can no longer be edited." }, { status: 404 });
    }
    /**
     * ⚠️ AN APPROVED BRIEF MAY STILL BE EDITED, and this is the case the whole
     * revision design exists for. Nitsan: "what happens if i get an update to a
     * brief i already turned into a task, edited its text and refined it as i
     * wish… i want to see what changed and deal with changes with carefulness
     * not erasing edits i already made." So the client's change lands HERE, on
     * the request row, and the task keeps the words the studio wrote. Applying
     * any of it to the task is an explicit action in the queue.
     *
     * ⚠️ `seen_at`/`seen_by` are CLEARED, at Nitsan's request: a brief he had
     * marked as read is not read any more once the client rewrites it. The
     * queue's "needs review" test is `edited_at > acked_at`, so clearing these
     * keeps the two readings of "handled" consistent rather than leaving a ✓ on
     * something nobody has looked at.
     *
     * ⚠️ `answers_ack`, `acked_at`, `status`, `created_at` and
     * `client_notified_at` are all deliberately untouched. `answers_ack` is the
     * baseline the diff is measured from — overwriting it here would erase the
     * very comparison the studio needs; and re-opening a status would undo the
     * studio's own decision on the strength of a client's edit.
     */
    const { error: upErr } = await sb
      .from("task_requests")
      .update({ ...row, edited_at: new Date().toISOString(), seen_at: null, seen_by: null })
      .eq("id", editId);
    if (upErr) {
      console.error("intake edit failed", upErr);
      return NextResponse.json({ error: "Could not save your changes — please try again." }, { status: 500 });
    }
    await notify(sb, answers, { files, links, dropped }, true);
    return NextResponse.json({
      ok: true,
      id: editId,
      editKey,
      // Lets the form thank them differently for revising work already under way.
      wasStarted: existing.status !== "pending",
    });
  }

  // ⚠️ The key is minted below and returned exactly ONCE — it is never selected
  // back out to anyone. The client's own browser is the only place it lives,
  // which is what makes editing safe without an account: there is no lookup by
  // email address, so nothing can be enumerated by someone holding the link.
  const base = {
    ...row,
    intake_link_id: link.id,
    client_id: clientId,
    suggested_client_id: suggested,
    status: "pending",
  };

  /**
   * ⚠️ ONE RUNG DOWN IF 0029 HASN'T BEEN APPLIED, and this matters more than it
   * looks: without the fallback an unapplied migration makes `edit_key` an
   * unknown column, the insert fails, and EVERY CLIENT SUBMISSION 500s — the
   * form would be dead for the studio's clients until someone ran SQL. The same
   * step-down the boot query uses (`isMissingSchema`, `42703`), and only for a
   * missing column: any other failure is a real failure and must surface.
   *
   * The cost of the fallback is that a brief submitted in that window gets no
   * edit key, so the client cannot edit THAT one. They can still duplicate it
   * once the column exists... no: with no key it is not remembered at all, and
   * it behaves exactly as every brief did before this feature. Correct, and
   * invisible.
   */
  let request: { id: string } | null = null;
  let key: string | null = crypto.randomUUID() + crypto.randomUUID().slice(0, 8);
  {
    const first = await sb
      .from("task_requests")
      .insert({ ...base, edit_key: key })
      .select("id")
      .single();
    if (first.error && isMissingSchema(new DbError("task_requests", first.error.message, first.error.code))) {
      key = null;
      const retry = await sb.from("task_requests").insert(base).select("id").single();
      if (retry.error) {
        console.error("intake submission failed", retry.error);
        return NextResponse.json({ error: "Could not submit — please try again." }, { status: 500 });
      }
      request = retry.data;
    } else if (first.error) {
      console.error("intake submission failed", first.error);
      return NextResponse.json({ error: "Could not submit — please try again." }, { status: 500 });
    } else {
      request = first.data;
    }
  }

  await notify(sb, answers, { files, links, dropped }, false);

  return NextResponse.json({ ok: true, id: request.id, editKey: key });
}
