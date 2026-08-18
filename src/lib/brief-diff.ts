import { CONTACT_FIELDS, FIELDS } from "./intake-fields";
import type { BriefLink, Deliverable, IntakeFile } from "./brief";

/**
 * What a client changed in a brief since the studio last acknowledged it.
 *
 * ⚠️ WHY THIS IS A PURE MODULE AND NOT INLINE IN THE QUEUE: the answer it gives
 * decides whether an admin's own rewriting of a task survives. Nitsan's case —
 * "an update to a brief i already turned into a task, edited its text and
 * refined it as i wish… i want to see what changed and deal with changes with
 * carefulness not erasing edits i already made" — means the comparison has to be
 * trustworthy and testable, and the UI's job is to RENDER a decision rather than
 * make one. It also means this module never writes anything: applying a change
 * is an explicit action in the queue.
 *
 * The baseline is `answers_ack` (0030): the client's words as the studio last
 * read them, snapshotted when an admin marks a brief seen or approves it. Not
 * the task's text — the task is the STUDIO's words and is not a version of the
 * client's answers at all.
 */

export interface FieldChange {
  key: string;
  label: string;
  was: string;
  now: string;
}

export interface FileChange {
  name: string;
  url: string;
  size?: number;
}

export interface BriefDiff {
  /**
   * True when there is no baseline to compare against — an old brief edited for
   * the first time, from before 0030. ⚠️ The UI must say so rather than showing
   * an empty diff, which would read as "nothing changed".
   */
  noBaseline: boolean;
  fields: FieldChange[];
  addedFiles: FileChange[];
  removedFiles: FileChange[];
  keptFiles: FileChange[];
  addedLinks: BriefLink[];
  removedLinks: BriefLink[];
  /** Rendered one-per-line, because a deliverable has no stable identity. */
  deliverablesWas: string[];
  deliverablesNow: string[];
  deliverablesChanged: boolean;
  /** Nothing at all differs — possible when a client re-saves without editing. */
  empty: boolean;
}

type Answers = Record<string, unknown>;

const str = (a: Answers, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

function fileList(a: Answers): FileChange[] {
  const raw = Array.isArray(a.files) ? (a.files as IntakeFile[]) : [];
  return raw
    .filter((f) => f && typeof f.url === "string")
    .map((f) => ({ name: f.name ?? "", url: f.url, size: f.size }));
}

function linkList(a: Answers): BriefLink[] {
  const raw = Array.isArray(a.links) ? (a.links as BriefLink[]) : [];
  return raw.filter((l) => l && typeof l.url === "string");
}

/** `Roll-up 1 — 80 × 200 cm · Print — the 2027 tagline` */
function renderDeliverable(d: Deliverable): string {
  const spec = [d.dimensions, d.format].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
  return [(d.name ?? "").trim(), spec, (d.details ?? "").trim()].filter(Boolean).join(" — ");
}

function deliverableLines(a: Answers): string[] {
  const raw = Array.isArray(a.deliverables) ? (a.deliverables as Deliverable[]) : [];
  return raw.map(renderDeliverable).filter(Boolean);
}

/**
 * ⚠️ Compared by URL, not by NAME. Two different files can share a name — a
 * client sending `logo.png` twice from different folders is ordinary — and a
 * duplicate brief deliberately re-uses the very same object, so the URL is the
 * only thing that identifies one.
 */
export function diffBriefs(current: Answers | null, baseline: Answers | null): BriefDiff {
  const now = current ?? {};
  const noBaseline = baseline == null;
  const was = baseline ?? {};

  const fields: FieldChange[] = [];
  // ⚠️ Driven by FIELDS, so a question added to the form appears here with no
  // further work — the same table the form, the brief and `missingFields` read.
  for (const key of Object.keys(FIELDS)) {
    // ⚠️ Reads the shared list rather than naming the three fields again — the
    // form's own first step is built from the same constant, so "which fields are
    // the person, not the work" is stated once. See CONTACT_FIELDS.
    if ((CONTACT_FIELDS as readonly string[]).includes(key)) continue;
    const a = str(was, key);
    const b = str(now, key);
    if (a !== b) fields.push({ key, label: FIELDS[key]?.label ?? key, was: a, now: b });
  }

  const nowFiles = fileList(now);
  const wasFiles = fileList(was);
  const wasUrls = new Set(wasFiles.map((f) => f.url));
  const nowUrls = new Set(nowFiles.map((f) => f.url));

  const nowLinks = linkList(now);
  const wasLinks = linkList(was);
  const wasLinkUrls = new Set(wasLinks.map((l) => l.url));
  const nowLinkUrls = new Set(nowLinks.map((l) => l.url));

  const deliverablesWas = deliverableLines(was);
  const deliverablesNow = deliverableLines(now);
  const deliverablesChanged = deliverablesWas.join("\n") !== deliverablesNow.join("\n");

  const diff: BriefDiff = {
    noBaseline,
    fields,
    addedFiles: nowFiles.filter((f) => !wasUrls.has(f.url)),
    removedFiles: wasFiles.filter((f) => !nowUrls.has(f.url)),
    keptFiles: nowFiles.filter((f) => wasUrls.has(f.url)),
    addedLinks: nowLinks.filter((l) => !wasLinkUrls.has(l.url)),
    removedLinks: wasLinks.filter((l) => !nowLinkUrls.has(l.url)),
    deliverablesWas,
    deliverablesNow,
    deliverablesChanged,
    empty: false,
  };
  diff.empty =
    !diff.fields.length &&
    !diff.addedFiles.length &&
    !diff.removedFiles.length &&
    !diff.addedLinks.length &&
    !diff.removedLinks.length &&
    !diff.deliverablesChanged;
  return diff;
}

/**
 * Does this brief need the studio to look again?
 *
 * ⚠️ ONE RULE FOR EVERY STATUS, deliberately. A pending brief the admin had
 * already read and an approved brief that is now a task are the same question —
 * "has the client changed anything since we last looked" — and a flag per case
 * is how two cases come to disagree. `acked_at` null with an edit present counts
 * as needing review: that is an old brief from before 0030, and the safe answer
 * is to show it.
 */
export function needsReview(r: { editedAt: string | null; ackedAt: string | null }): boolean {
  if (!r.editedAt) return false;
  if (!r.ackedAt) return true;
  return new Date(r.editedAt).getTime() > new Date(r.ackedAt).getTime();
}
