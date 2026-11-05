// A freelancer's details (v1.91.0, Nitsan 2026-11-05): email and phone in
// `member_hr` (where a candidate's conversion puts them, and finance-admin's
// person page reads them), website / location / notes on `freelancers` (0063).
// Admin-only both ways. This cleans what the page sends before it's stored.

import { normalizeUrl } from "@/lib/links";

export interface FreelancerDetails {
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  notes: string | null;
}

const text = (raw: unknown, max: number): string | null => {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, max);
  return t || null;
};

/**
 * The details to store, or the reason they can't be.
 *
 * ⚠️ THE WEBSITE BECOMES AN `href`, so it goes through `normalizeUrl`'s
 * http/https/mailto allowlist — a stored `javascript:` link would run on a
 * click. A bare "site.com" gets https://.
 */
export function cleanDetails(body: Record<string, unknown>): FreelancerDetails | { error: string } {
  const email = text(body.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email doesn't look right." };
  const phone = text(body.phone, 40);
  if (phone && !/^[+\d][\d\s().-]{4,}$/.test(phone)) return { error: "That phone number doesn't look right." };
  const site = text(body.website, 500);
  const website = site ? normalizeUrl(site) : null;
  if (site && !website) return { error: "That website isn't a link that can be opened." };
  return { email, phone, website, location: text(body.location, 120), notes: text(body.notes, 4000) };
}
