"use client";

// A saved applicant email (`.eml`) → a candidate on the board.
//
// ⚠️ PARSED IN THE BROWSER, NOT POSTED WHOLE. A Vercel function takes at most
// ~4.5MB of request body, and an application with a CV and a portfolio PDF is
// often bigger than that once base64'd into a mail. So the MIME is opened here
// and each attachment goes up on its own through `/api/candidate-file` — the
// same admin-gated, allowlisted route the dossier's CV button uses — which
// also hands back a PDF's text so the phone and links can be found in it.
//
// ⚠️ THE SAME PERSON TWICE IS ONE CANDIDATE. Matched on email: a second
// application lands on the existing card as a message in the discussion plus
// any files and links it doesn't already have, rather than as a second card.

import { createClient } from "../supabase/client";
import { addComment, addLink, CandidateWriteError, createCandidate, updateCandidate } from "./actions";
import {
  appliedOnOf,
  attachmentName,
  bodyOf,
  cleanFileName,
  documentLinks,
  extractEmail,
  extractLinks,
  extractPhone,
  FORM_UPLOAD_HOST,
  formatPhone,
  MAX_APPLICATION_CHARS,
  parseWebsiteForm,
  pickApplicant,
  planAttachments,
  portfolioFromField,
  roleFromInterests,
  sourceOf,
  storedNameOf,
} from "./email-import";
import { NEW_CANDIDATE_NAME } from "./types";

export interface ImportResult {
  candidateId: string;
  /** False when the email matched somebody already on file. */
  created: boolean;
  name: string;
  files: number;
  /** Attachments that could not be stored, by name — the caller says so. */
  skipped: string[];
}

interface Uploaded {
  path: string;
  url: string;
  title: string;
  text?: string;
  links?: string[];
}

/** A file to store, or a link for the server to fetch one from. */
async function upload(
  what: File | { fromUrl: string; title: string; name?: string; storeAs?: string | null },
  candidateId: string,
): Promise<Uploaded> {
  const body = new FormData();
  if (what instanceof File) {
    body.append("file", what);
  } else {
    body.append("fromUrl", what.fromUrl);
    body.append("title", what.title);
    if (what.name) body.append("name", what.name);
    if (what.storeAs) body.append("storeAs", what.storeAs);
  }
  body.append("candidateId", candidateId);
  body.append("extract", "1");
  const res = await fetch("/api/candidate-file", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as Partial<Uploaded> & { error?: string };
  if (!res.ok || !json.url || !json.path) throw new Error(json.error ?? "not stored");
  return json as Uploaded;
}

/** `ilike` treats `_` and `%` as wildcards, and `_` is common in addresses. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function importApplicationEmail(
  file: File,
  stageId: string | null,
  actorId: string | null,
  roles: { id: string; name: string }[] = [],
): Promise<ImportResult> {
  const { default: PostalMime } = await import("postal-mime");
  let mail;
  try {
    mail = await PostalMime.parse(await file.arrayBuffer());
  } catch {
    throw new CandidateWriteError("read the email", "That file isn't an email we can read.");
  }

  const from = mail.from && "address" in mail.from && mail.from.address ? mail.from : null;
  const replyTo = (mail.replyTo ?? []).flatMap((a) => ("address" in a && a.address ? [a] : []));
  const parsed = { ...mail, from, replyTo };
  const body = bodyOf(parsed);
  // The studio website's form names the applicant in its fields; the sender
  // is the form itself, which is why the first website import came out as
  // "New candidate".
  const form = parseWebsiteForm(body);
  const applicant =
    form?.name && form.email ? { name: form.name, email: form.email } : pickApplicant(parsed, body);
  const text = (form ? form.text : body).slice(0, MAX_APPLICATION_CHARS);

  const sb = createClient();
  let existing: { id: string; name: string; phone: string | null; email: string | null } | null = null;
  if (applicant) {
    const { data } = await sb
      .from("candidates")
      .select("id, name, phone, email")
      .ilike("email", likeLiteral(applicant.email))
      .order("created_at")
      .limit(1);
    existing = (data ?? [])[0] ?? null;
  }

  const created = !existing;
  const candidateId =
    existing?.id ??
    (await createCandidate(
      {
        name: applicant?.name ?? NEW_CANDIDATE_NAME,
        email: applicant?.email ?? null,
        stageId,
        source: form ? "Website" : sourceOf(parsed, body),
        roleId: roleFromInterests(form?.interests ?? null, roles),
        applicationText: text || null,
        appliedOn: appliedOnOf(mail.date),
      },
      actorId,
    ));

  // What they already hold, so a second import of the same mail adds nothing twice.
  const { data: held } = await sb
    .from("candidate_links")
    .select("title, url, kind, storage_path")
    .eq("candidate_id", candidateId);
  const heldLinks = held ?? [];
  const heldFiles = new Set(heldLinks.filter((l) => l.storage_path).map((l) => l.title.toLowerCase()));
  const heldUrls = new Set(heldLinks.map((l) => l.url.toLowerCase().replace(/\/$/, "")));
  const heldPaths = heldLinks.flatMap((l) => (l.storage_path ? [l.storage_path as string] : []));
  let cvTaken = heldLinks.some((l) => l.kind === "cv");
  let position = heldLinks.length + 1;

  // ── attachments ──
  const atts = mail.attachments.map((a, i) => ({
    raw: a,
    filename: attachmentName(a.filename, a.mimeType, i),
    mimeType: a.mimeType,
    inline: a.disposition === "inline" || !!a.related,
  }));
  const plan = planAttachments(atts);
  const skipped: string[] = [];
  const pdfTexts: string[] = [];
  const pdfLinks: string[] = [];
  let files = 0;
  // The CV first, so its text is the one searched first for a phone.
  plan.sort((a, b) => Number(b.kind === "cv") - Number(a.kind === "cv"));
  for (const { index, kind } of plan) {
    const att = atts[index];
    // Titles are stored cleaned, so compare cleaned.
    if (heldFiles.has(cleanFileName(att.filename).toLowerCase())) continue;
    const content = att.raw.content;
    const blob =
      typeof content === "string"
        ? new Blob([content], { type: att.mimeType })
        : new Blob([content as BlobPart], { type: att.mimeType });
    try {
      const up = await upload(new File([blob], att.filename, { type: att.mimeType }), candidateId);
      const asKind = kind === "cv" && cvTaken ? "other" : kind;
      if (asKind === "cv") cvTaken = true;
      const title = cleanFileName(att.filename);
      await addLink(candidateId, title, up.url, asKind, up.path, asKind === "cv" ? 0 : position++);
      files++;
      if (up.text) pdfTexts.push(up.text);
      if (up.links) pdfLinks.push(...up.links);
    } catch {
      skipped.push(att.filename);
    }
  }

  // ── a CV sent as a LINK (Drive, Dropbox, a .pdf URL) ──
  // The server downloads it and keeps a copy, because share links get revoked
  // and the card should not lose the CV when they do. The original link is
  // kept beside the copy. Already-held links are not fetched again, so a
  // second import of the same mail costs nothing.
  for (const doc of documentLinks(form?.cvUrl ? [form.cvUrl, body] : [body])) {
    if (heldUrls.has(doc.url.toLowerCase().replace(/\/$/, ""))) continue;
    heldUrls.add(doc.url.toLowerCase().replace(/\/$/, ""));
    // The form's own upload is the CV and nothing else: titled "CV", as the
    // studio files it, and its S3 address is not kept as a second link.
    const formUpload = FORM_UPLOAD_HOST.test(new URL(doc.url).hostname);
    // ⚠️ SO THE ADDRESS CAN'T BE WHAT DEDUPES IT. The file is stored under the
    // URL's own filename instead — the form's carries a unique upload id — and
    // a re-import skips it when a stored file of that name is already held.
    // (Found on the second import of Ella Zell, which grew a "CV.pdf".)
    const storeAs = storedNameOf(doc.url);
    if (storeAs && heldPaths.some((p) => p.endsWith(`-${storeAs}`))) continue;
    try {
      const up = await upload(
        { fromUrl: doc.fetchUrl, title: doc.title, name: formUpload ? "CV" : undefined, storeAs },
        candidateId,
      );
      const asKind = cvTaken ? "other" : "cv";
      if (asKind === "cv") cvTaken = true;
      await addLink(candidateId, up.title, up.url, asKind, up.path, asKind === "cv" ? 0 : position++);
      files++;
      if (up.text) pdfTexts.push(up.text);
      if (up.links) pdfLinks.push(...up.links);
    } catch {
      skipped.push(`the CV linked on ${doc.title} (private, or not a PDF)`);
    }
    if (!formUpload) await addLink(candidateId, doc.title, doc.url, "other", null, position++);
  }

  // The form's Portfolio field is usually a bare domain ("ellazell.com"),
  // which the free-text link finder rightly won't guess at.
  const formPortfolio = form?.portfolio ? portfolioFromField(form.portfolio) : null;
  if (formPortfolio && !heldUrls.has(formPortfolio.url.toLowerCase())) {
    heldUrls.add(formPortfolio.url.toLowerCase());
    await addLink(candidateId, formPortfolio.title, formPortfolio.url, formPortfolio.kind, null, position++);
  }

  // ── links: the mail's, then the PDFs' own hyperlinks, then their text ──
  for (const link of extractLinks([body, pdfLinks.join("\n"), ...pdfTexts])) {
    if (heldUrls.has(link.url.toLowerCase())) continue;
    heldUrls.add(link.url.toLowerCase());
    await addLink(candidateId, link.title, link.url, link.kind, null, position++);
  }

  // ── contact details: only fill what is empty, never overwrite ──
  const patch: { phone?: string; email?: string } = {};
  const phone = form?.phone ?? extractPhone(body) ?? pdfTexts.map(extractPhone).find(Boolean) ?? null;
  if (phone && !existing?.phone) patch.phone = formatPhone(phone);
  if (!applicant && !existing) {
    const email = pdfTexts.map(extractEmail).find(Boolean);
    if (email) patch.email = email;
  }
  if (Object.keys(patch).length) await updateCandidate(candidateId, patch, actorId);

  if (!created) {
    const when = appliedOnOf(mail.date);
    const head = `Applied again by email${when ? ` on ${when}` : ""}${mail.subject ? ` — ${mail.subject}` : ""}`;
    await addComment(candidateId, text ? `${head}\n\n${text}` : head, actorId);
  }

  return {
    candidateId,
    created,
    name: existing?.name ?? applicant?.name ?? NEW_CANDIDATE_NAME,
    files,
    skipped,
  };
}
