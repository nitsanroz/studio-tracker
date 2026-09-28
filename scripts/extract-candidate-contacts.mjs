#!/usr/bin/env node
/**
 * Pull the email, phone and links out of a candidate's application text and
 * into the fields that exist for them.
 *
 *   node --env-file=.env.local scripts/extract-candidate-contacts.mjs          # dry run
 *   node --env-file=.env.local scripts/extract-candidate-contacts.mjs --apply
 *   node --env-file=.env.local scripts/extract-candidate-contacts.mjs --apply --strip
 *
 * Why it exists: the Asana board had no contact fields, so people put a phone
 * number, a mail address and a LinkedIn URL in the card's notes. The import
 * carried that across verbatim — correctly, but it leaves Phone and Email blank
 * on a page that has boxes for exactly those things.
 *
 * ⚠️ IT NEVER PRINTS A VALUE. Counts and hostnames only, for the same two
 * reasons the import script gives: a terminal transcript is an easy place for
 * 271 people's contact details to leak out of, and HR-grade PII in a Claude
 * session locks that session's tooling (CLAUDE.md, "Session gotcha (PII)").
 *
 * ⚠️ IT ONLY EVER FILLS A FIELD THAT IS EMPTY. A phone number somebody typed by
 * hand beats one a regular expression found in a paragraph, always.
 *
 * ⚠️ `--strip` IS OPT-IN AND CONSERVATIVE. Without it the application text is
 * left exactly as the candidate wrote it — the detail is COPIED out, not moved.
 * With it, a line is removed only when the contact detail was the whole line:
 * a bare `+972501234567` goes, while "you can reach me on +972501234567 after
 * six" stays, because deleting that sentence would be rewriting what somebody
 * actually sent us.
 */

const APPLY = process.argv.includes("--apply");
const STRIP = process.argv.includes("--strip");

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

const get = async (p) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
};
const write = async (method, p, body) => {
  const r = await fetch(`${U}/rest/v1/${p}`, {
    method,
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${await r.text()}`);
};

import { extract, hostOf, isLinkedIn, stripLines } from "./lib/contact-extract.mjs";

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? "── APPLYING ──" : "── DRY RUN (pass --apply to write) ──");
  if (APPLY && STRIP) console.log("--strip: contact-only lines will be removed from the text");

  const candidates = await get(
    "candidates?select=id,email,phone,application_text&application_text=not.is.null&limit=1000",
  );
  const existingLinks = await get("candidate_links?select=candidate_id,url&limit=2000");
  const linksByCandidate = new Map();
  for (const l of existingLinks) {
    const set = linksByCandidate.get(l.candidate_id) ?? new Set();
    set.add(l.url.toLowerCase());
    linksByCandidate.set(l.candidate_id, set);
  }

  let wouldEmail = 0,
    wouldPhone = 0,
    wouldLinkedIn = 0,
    wouldPortfolio = 0,
    wouldStrip = 0,
    emailKept = 0,
    phoneKept = 0;
  const hosts = {};
  const jobs = [];

  for (const c of candidates) {
    const text = c.application_text ?? "";
    const found = extract(text);
    const patch = {};

    if (found.emails.length) {
      if (c.email) emailKept++;
      else {
        patch.email = found.emails[0];
        wouldEmail++;
      }
    }
    if (found.phones.length) {
      if (c.phone) phoneKept++;
      else {
        patch.phone = found.phones[0];
        wouldPhone++;
      }
    }

    const have = linksByCandidate.get(c.id) ?? new Set();
    const newLinks = [];
    for (const raw of found.urls) {
      const url = raw.startsWith("http") ? raw : `https://${raw}`;
      if (have.has(url.toLowerCase())) continue;
      have.add(url.toLowerCase());
      const host = hostOf(url);
      hosts[host] = (hosts[host] ?? 0) + 1;
      if (isLinkedIn(url)) {
        newLinks.push({ candidate_id: c.id, title: "LinkedIn", url, kind: "other", position: 50 });
        wouldLinkedIn++;
      } else {
        // ⚠️ Everything that is not LinkedIn is filed as a PORTFOLIO rather
        // than guessed at more finely. A Drive link might be a CV and might be
        // a folder of work; `kind` is one click to change and a wrong guess is
        // a CV chip pointing at somebody's Instagram.
        newLinks.push({ candidate_id: c.id, title: host, url, kind: "portfolio", position: 51 });
        wouldPortfolio++;
      }
    }

    let strippedText = null;
    if (STRIP && (found.emails.length || found.phones.length || found.urls.length)) {
      const next = stripLines(text, found);
      if (next !== text.trim()) {
        strippedText = next;
        wouldStrip++;
      }
    }

    if (Object.keys(patch).length || newLinks.length || strippedText !== null) {
      jobs.push({ id: c.id, patch, newLinks, strippedText });
    }
  }

  console.log(`\n${candidates.length} candidates have application text.`);
  console.log(`  email  → would fill ${wouldEmail} empty field(s); ${emailKept} already set, left alone`);
  console.log(`  phone  → would fill ${wouldPhone} empty field(s); ${phoneKept} already set, left alone`);
  console.log(`  links  → ${wouldLinkedIn} LinkedIn, ${wouldPortfolio} portfolio/other`);
  if (STRIP) console.log(`  text   → ${wouldStrip} would have contact-only lines removed`);

  // ⚠️ ONLY HOSTS THAT SEVERAL PEOPLE SHARE. An earlier version printed the top
  // twelve and put `firstnamelastname.com` in the terminal three times over — a
  // personal domain IS a name, so "a hostname is not personal data" was simply
  // wrong. A host that appears for three or more different candidates is a
  // platform (behance, drive, instagram); anything rarer is somebody's own site
  // and is counted, not named.
  const shared = Object.entries(hosts)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1]);
  const personal = Object.entries(hosts).filter(([, n]) => n < 3);
  if (shared.length) {
    console.log("\nplatforms found:");
    for (const [h, n] of shared) console.log(`  ${String(n).padStart(4)}  ${h}`);
  }
  if (personal.length) {
    console.log(
      `  ${String(personal.reduce((a, [, n]) => a + n, 0)).padStart(4)}  on ${personal.length} personal sites (not listed — a personal domain is a name)`,
    );
  }

  if (!APPLY) {
    console.log(`\n${jobs.length} candidates would change. Nothing written.`);
    return;
  }

  let patched = 0,
    linked = 0,
    stripped = 0;
  for (const j of jobs) {
    const body = { ...j.patch };
    if (j.strippedText !== null) body.application_text = j.strippedText || null;
    if (Object.keys(body).length) {
      await write("PATCH", `candidates?id=eq.${j.id}`, body);
      if (Object.keys(j.patch).length) patched++;
      if (j.strippedText !== null) stripped++;
    }
    if (j.newLinks.length) {
      await write("POST", "candidate_links", j.newLinks);
      linked += j.newLinks.length;
    }
  }
  console.log(`\npatched ${patched} candidate(s), added ${linked} link(s), rewrote ${stripped} text(s)`);
}

main().catch((e) => {
  // The message only — an error body can echo the row, and the row is a person.
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
