import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/app-origin";
import { domainOf } from "@/lib/leads/types";

/**
 * The studionmore.com contact form → a lead in the first stage.
 *
 * Framer's form "Send to webhook" POSTs the submission here. The URL carries a
 * 64-character secret from `lead_settings.inbound_token` (0042), shown to
 * admins in Settings → Leads; anything without it gets a 404.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED, so it follows the intake form's rules: the
 * service key stays on the server, the body is size-capped, and submissions are
 * rate-limited in the DATABASE (a serverless function has no memory between
 * calls). Like intake it FAILS OPEN if the count itself errors — a lost enquiry
 * costs the studio a client; a spam window costs a few deletes.
 *
 * ⚠️ FIELD NAMES ARE WHATEVER THE FORM CALLS THEM. Framer sends the form's own
 * labels as keys ("Name", "Email", "Company", "Message"…), so they are matched
 * loosely rather than by an exact schema — and every field, matched or not, is
 * kept verbatim in the lead's first note, so renaming a field on the website
 * can never silently lose what somebody typed.
 *
 * ⚠️ THE SAME PERSON WRITING AGAIN DOES NOT OPEN A SECOND LEAD. If their email
 * is already a contact on a lead created in the last 90 days, the message is
 * logged on that lead instead.
 */

const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX = 8;
const MAX_FIELD = 5000;
const MAX_FIELDS = 40;
const RECENT_DAYS = 90;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Flatten whatever arrived into label → text, capped. */
async function readFields(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (Object.keys(out).length >= MAX_FIELDS) return;
    const key = String(k).slice(0, 80).trim();
    if (!key) return;
    const val =
      typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    if (val.trim()) out[key] = val.slice(0, MAX_FIELD).trim();
  };
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as unknown;
    // Some senders wrap the fields one level down ({ data: {...} } / { fields: {...} }).
    const obj =
      body && typeof body === "object"
        ? ((body as Record<string, unknown>).data ??
            (body as Record<string, unknown>).fields ??
            body)
        : {};
    if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) put(k, v);
  } else {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => put(k, v));
  }
  return out;
}

/** Constant-time, so the 404 cannot be used to guess the secret a byte at a time. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");

/** The first field whose normalised label matches one of `names`. */
function pick(fields: Record<string, string>, names: string[]): string | null {
  for (const [k, v] of Object.entries(fields)) if (names.includes(norm(k))) return v;
  for (const [k, v] of Object.entries(fields)) if (names.some((n) => norm(k).includes(n))) return v;
  return null;
}

async function notify(
  sb: ReturnType<typeof service>,
  leadId: string,
  company: string,
  fields: Record<string, string>,
  repeat: boolean,
) {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const { data: admins } = await sb.from("profiles").select("id").eq("role", "admin").eq("active", true);
    const ids = new Set(((admins ?? []) as { id: string }[]).map((a) => a.id));
    if (ids.size === 0) return;
    const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
    const to = (data?.users ?? []).filter((u) => ids.has(u.id) && u.email).map((u) => u.email!);
    if (to.length === 0) return;
    const esc = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const rows = Object.entries(fields)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`,
      )
      .join("");
    // ⚠️ appOrigin(), never the request's Host — this route is public, and a
    // forged Host would put an attacker's link inside a real studio mail.
    const link = `${appOrigin()}/leads/${leadId}`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.INTAKE_FROM_EMAIL || "Studio&more Tracker <onboarding@resend.dev>",
        to,
        subject: `${repeat ? "Website form again" : "New lead"}: ${company}`,
        html: `<p>${repeat ? "Someone already on the board wrote again through the website." : "A new enquiry came in through the website form."}</p><table style="font:14px/1.5 sans-serif;border-collapse:collapse">${rows}</table><p><a href="${link}">Open the lead</a></p>`,
      }),
    });
  } catch (e) {
    console.error("leads inbound email failed", e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = service();

  const { data: secret } = await sb
    .from("lead_settings")
    .select("value")
    .eq("key", "inbound_token")
    .maybeSingle();
  const expected = (secret as { value?: unknown } | null)?.value;
  if (typeof expected !== "string" || expected.length < 32 || !sameSecret(token, expected)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count: recent, error: rateErr } = await sb
    .from("lead_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "email")
    .contains("meta", { via: "website_form" })
    .gte("created_at", since);
  if (rateErr) console.error("leads inbound rate limit check failed — allowing", rateErr.message);
  if ((recent ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ error: "Too many submissions — please try again shortly." }, { status: 429 });
  }

  const fields = await readFields(req);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Empty submission" }, { status: 400 });
  }

  const email = pick(fields, ["email", "emailaddress", "mail"]);
  const first = pick(fields, ["firstname"]);
  const last = pick(fields, ["lastname", "surname"]);
  const name = pick(fields, ["name", "fullname", "yourname", "contactname"]) ?? ([first, last].filter(Boolean).join(" ") || null);
  const companyField = pick(fields, ["company", "companyname", "organization", "organisation", "business", "brand"]);
  const website = pick(fields, ["website", "url", "site", "companywebsite", "link"]);
  const phone = pick(fields, ["phone", "phonenumber", "tel", "mobile"]);
  const title = pick(fields, ["title", "jobtitle", "role", "position"]);
  const message = pick(fields, ["message", "details", "project", "about", "howcanwehelp", "description", "notes", "brief"]);

  const domain = domainOf(website) ?? domainOf(email);
  const company = (companyField || domain || name || "Website enquiry").slice(0, 200);
  const transcript = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  // ── the same person again? ──
  if (email) {
    const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    const { data: known } = await sb
      .from("lead_contacts")
      .select("lead_id, leads!inner(id, company, created_at)")
      .ilike("email", email)
      .gte("leads.created_at", cutoff)
      .limit(1);
    const hit = (known ?? [])[0] as { lead_id?: string; leads?: { company?: string } } | undefined;
    if (hit?.lead_id) {
      const now = new Date().toISOString();
      await sb.from("lead_events").insert({
        lead_id: hit.lead_id,
        kind: "email",
        body: transcript,
        meta: { via: "website_form" },
      });
      await sb.from("leads").update({ last_activity_at: now }).eq("id", hit.lead_id);
      await notify(sb, hit.lead_id, hit.leads?.company ?? company, fields, true);
      return NextResponse.json({ ok: true });
    }
  }

  const { data: stage } = await sb
    .from("lead_stages")
    .select("id")
    .eq("kind", "open")
    .order("position")
    .limit(1)
    .maybeSingle();

  const { data: lead, error } = await sb
    .from("leads")
    .insert({
      company,
      website: website || (domain ? `https://${domain}` : null),
      domain,
      source: "website",
      stage_id: (stage as { id?: string } | null)?.id ?? null,
      asked_for: message ? message.slice(0, 300) : null,
    })
    .select("id")
    .single();
  if (error || !lead) {
    console.error("leads inbound insert failed", error);
    return NextResponse.json({ error: "Could not save the submission" }, { status: 500 });
  }
  const leadId = (lead as { id: string }).id;

  if (name || email || phone) {
    await sb.from("lead_contacts").insert({
      lead_id: leadId,
      name: (name || email || "Website contact").slice(0, 200),
      email,
      phone,
      title,
      position: 1,
    });
  }
  await sb.from("lead_events").insert([
    { lead_id: leadId, kind: "created", body: "From the website form" },
    { lead_id: leadId, kind: "email", body: transcript, meta: { via: "website_form" } },
  ]);

  await notify(sb, leadId, company, fields, false);
  return NextResponse.json({ ok: true });
}
