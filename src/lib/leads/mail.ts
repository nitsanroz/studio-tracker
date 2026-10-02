// Server-side mail for Leads — the offer-review alert and the morning digest.
// Same Resend call the intake form makes; nothing here is reachable from a
// browser bundle.

import type { SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "../app-origin";

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendMail(to: string[], subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || to.length === 0) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.INTAKE_FROM_EMAIL || "Studio&more Tracker <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) console.error("[leads mail] Resend refused", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/** Active admins' sign-in addresses, keyed by profile id. `profiles` has no email; auth.users does. */
export async function adminEmails(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data: admins } = await sb.from("profiles").select("id").eq("role", "admin").eq("active", true);
  const ids = new Set(((admins ?? []) as { id: string }[]).map((a) => a.id));
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  const out = new Map<string, string>();
  for (const u of data?.users ?? []) if (ids.has(u.id) && u.email) out.set(u.id, u.email);
  return out;
}

/**
 * Who a Leads email goes to: the profile ids saved under `key` in
 * `lead_settings` (Settings → Leads), or — when nothing is saved — every
 * active admin. Ids that are no longer active admins are dropped.
 */
export async function recipients(sb: SupabaseClient, key: "digest_recipients" | "approver_ids"): Promise<string[]> {
  const emails = await adminEmails(sb);
  const { data } = await sb.from("lead_settings").select("value").eq("key", key).maybeSingle();
  const saved = (data as { value?: unknown } | null)?.value;
  const ids = Array.isArray(saved) ? (saved as string[]) : [...emails.keys()];
  return ids.map((id) => emails.get(id)).filter((e): e is string => Boolean(e));
}

export const leadUrl = (id: string) => `${appOrigin()}/leads/${id}`;
export const boardUrl = () => `${appOrigin()}/leads`;
