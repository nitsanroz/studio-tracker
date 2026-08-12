// Turns intake-form answers into a design brief.
//
// The rule is: never invent information, never repeat what the task itself
// already shows, and never print a gap. An earlier version marked every
// unanswered field "Not provided" and then listed them all again under
// MISSING INFORMATION — see `briefParts` for why three real hand-edited briefs
// argued that out of existence.

// ⚠️ `intake-fields` imports only a TYPE back from here, so this pair does not
// form a runtime cycle — keep it that way.
import { fieldsAsked } from "./intake-fields";

/**
 * One named piece of work inside a single brief — "Roll-up 1", "Banner 2",
 * "Front".
 *
 * ⚠️ This exists because clients were already writing them, as bare lines
 * inside the creative-brief textarea, and nothing could tell those lines apart
 * from the bullet points under them: across three real briefs the headings were
 * `Roll-up 1`, `Visual direction`, `Front`, while the lines beneath included
 * `Notraffic logo` and `Full event agenda` — same length, same punctuation, no
 * rule separates them. Declared as data, a name can be emphasised with
 * certainty instead of guessed at.
 */
export interface Deliverable {
  name: string;
  details: string;
}

export interface IntakeAnswers {
  name: string;
  email: string;
  company: string;
  taskName: string;
  /**
   * Which `WORK_KINDS` the client picked — what decided the questions they saw.
   *
   * ⚠️ A LIST. One task routinely holds pieces of different kinds (a roll-up
   * and a social post for the same event), and the questions asked are the
   * union. Optional: every submission archived before the stepped form has
   * none, and those were asked everything.
   */
  kinds?: string[];
  /** Named pieces, when the client listed them. */
  deliverables?: Deliverable[];
  dimensions: string;
  format: string;
  animated: string;
  /** The catch-all on the technical step — whatever the questions missed. */
  techNotes?: string;
  dueDate: string; // yyyy-mm-dd or ""
  budgetRange: string;
  creativeBrief: string;
  goal: string;
  displayedWhere: string;
  targetAudience: string;
  thingsToAvoid: string;
  content: string;
  notes: string;
  scheduleMeeting: string;
}

export interface IntakeFile {
  name: string;
  url: string;
}

/** A titled link the client added on the form with "+ Add link". */
export interface BriefLink {
  title: string;
  url: string;
}

/**
 * What the client attached: uploads and their own links.
 *
 * ⚠️ Passing this to `assembleTaskBrief` is OPTIONAL, and the difference
 * matters. The submission's own brief lists them as text, because at that
 * moment there is no task to hang a link row off and the queue card and the
 * notification email are the only places anyone can reach the files.
 *
 * The brief copied onto the APPROVED task omits them — by then `approveRequest`
 * has turned every one into a real row in `links`, and leaving the raw URLs in
 * the text as well would put each Supabase storage URL (~150 unreadable
 * characters) into the brief twice over. That is the exact noise migration 0022
 * created the links table to get rid of.
 */
export interface BriefAttachments {
  files: IntakeFile[];
  links: BriefLink[];
  /**
   * Files the client attached that never made it — each already phrased as
   * "name — why". Normally empty: the form runs the same check before
   * submitting, so this only fills on a storage failure or a client that
   * bypassed the form.
   *
   * ⚠️ Recorded because the alternative is what used to happen — the file
   * vanished, the client was thanked, and the brief gave no hint an attachment
   * was ever meant to exist. A brief that says a file is missing is worth far
   * more than one that silently omits it.
   */
  dropped?: string[];
}

const FIELD_LABELS: [keyof IntakeAnswers, string][] = [
  ["dimensions", "Dimensions/Technical Specifications"],
  ["format", "Format"],
  ["animated", "Would it be animated"],
  ["dueDate", "Due Date"],
  ["budgetRange", "Budget Range"],
  ["creativeBrief", "Creative Brief"],
  ["goal", "Goal of the deliverable"],
  ["displayedWhere", "Where it will be displayed"],
  ["targetAudience", "Target audience"],
  ["thingsToAvoid", "Things to avoid"],
  ["content", "Content"],
  ["notes", "Notes"],
];

const val = (s: string) => (s && s.trim() ? s.trim() : "");
const orNP = (s: string) => val(s) || "Not provided";

/**
 * A written-out "nothing here" — the client typed something, but it carries no
 * more information than a blank box would.
 *
 * ⚠️ Measured, not guessed. Across the studio's 49 archived submissions these
 * account for **46 instances** — very nearly one per brief. `-` alone fills
 * Dimensions 13 times, Notes 7, and Things-to-avoid 4; every one of them would
 * otherwise print as a labelled line saying nothing.
 *
 * "no" is included on the same evidence (Notes reads "No" three times, meaning
 * "no notes"). ⚠️ That is safe for the two questions where No IS an answer only
 * because both `animated` and `scheduleMeeting` are separately suppressed on No
 * anyway — if either ever needs to render a "No", this list must lose it.
 */
const EMPTY_ANSWERS = /^(no(ne)?|n\/?[ar]|nothing|nope|[-–—]+)$/i;

/**
 * ⚠️ Trailing punctuation and smileys are stripped BEFORE matching. The archive
 * contains `none.`, `Nope.`, `None :)` and `--` — people are polite about
 * saying nothing — and an unstripped match caught none of them. `N/R` (not
 * relevant) sits alongside `N/A`, which is why the class is `[ar]`.
 *
 * It does not over-reach: `THE WORLD.`, `Thank you!` and `Welcome!` all survive
 * the strip and are correctly kept.
 */
const said = (s: string) => {
  const t = val(s)
    .replace(/[:;]-?[)D]\s*$/, "")
    .replace(/[.!]+\s*$/, "")
    .trim();
  return !t || EMPTY_ANSWERS.test(t) ? "" : val(s);
};

/**
 * ⚠️ Anchored at BOTH ends. `/^no/i` — which is what this file used to use —
 * also matches **"Not sure yet"**, one of the three options the form offers for
 * "Would it be animated?". A client who told us they don't know would have had
 * that read as "no" and dropped, which is precisely the silent information loss
 * this rewrite exists to stop.
 */
const isNo = (s: string) => /^no$/i.test(val(s));

/**
 * What the brief actually shows, in order, as `Label: value` pairs — the single
 * source for both the plain-text brief and the HTML notification email, so the
 * two cannot drift into different shapes.
 *
 * ⚠️ The whole ordering and inclusion policy here was DERIVED from three real
 * before/after pairs (No Traffic: Banners, Roll ups, Name Tags), comparing the
 * generated brief against the task Nitsan hand-edited it into. The deletions
 * were the specification. In all three he removed:
 *
 *   - the `SUMMARY` heading and the `notraffic requests "X"` opening sentence —
 *     the client is the Client chip and X is the task title, both already on the
 *     task, and repeating them is the single biggest source of noise;
 *   - `due …`, which is the Dates field;
 *   - `animated: No` — all three were print jobs, and the absence of a property
 *     nobody asked about is not information;
 *   - every `Not provided` line, and the entire `MISSING INFORMATION` block;
 *   - the `FILES`/`LINKS` URL dumps, which are real rows by then.
 *
 * And in all three he kept the answered labelled lines verbatim, in order, plus
 * the client's own free text exactly as typed. So: **emit only what was
 * answered, never what the task already knows, and never touch the wording.**
 */
/**
 * A declared piece, as its own block.
 *
 * ⚠️ The name is emitted plain for now. It is the thing that wants emphasis,
 * and the moment the brief renderer understands `**bold**` this is the single
 * line that changes — which is the point of the client declaring it rather than
 * typing it into a paragraph.
 */
function blocksForDeliverable(into: string[], name: string, details: string) {
  if (!name) into.push(details);
  else into.push(details ? `${name}\n${details}` : name);
}

function briefParts(a: IntakeAnswers): { specs: string[]; body: string[] } {
  const specs: string[] = [];
  const body: string[] = [];
  const put = (into: string[], label: string, raw: string) => {
    const v = said(raw);
    if (v) into.push(`${label}: ${v}`);
  };

  // ⚠️ Format and Dimensions are SEPARATE lines and never combined. The old
  // opener embedded the size in the format (`Print (85 × 200 cm)`) while
  // TASK DESCRIPTION printed it again — and Nitsan resolved that duplicate
  // three different ways across three briefs (deleted it, kept it, moved it).
  // Two plain lines remove the decision.
  put(specs, "Format", a.format);
  put(specs, "Dimensions", a.dimensions);
  // Budget stays, unlike the due date: the Hours field can only hold a number,
  // so "5-8" or "8 if we reuse last year's" loses its nuance the moment it is
  // parsed. The due date survives its field intact, so it goes.
  put(specs, "Budget", a.budgetRange);
  // Only when the answer is positive — same reasoning as the meeting request
  // below, and the same anchored test.
  if (said(a.animated) && !isNo(a.animated)) {
    specs.push(`Animated: ${said(a.animated)}`);
  }

  put(specs, "Technical notes", a.techNotes ?? "");

  put(body, "Goal", a.goal);
  put(body, "Target audience", a.targetAudience);
  put(body, "Displayed at", a.displayedWhere);
  put(body, "Creative direction", a.creativeBrief);
  // Each declared piece is its own block: its name on one line, the client's
  // description under it. This is the structure clients were already typing
  // into the brief box by hand — now it arrives knowing what it is.
  for (const d of a.deliverables ?? []) {
    const name = val(d?.name);
    const details = said(d?.details ?? "");
    if (!name && !details) continue;
    blocksForDeliverable(body, name, details);
  }
  put(body, "Content", a.content);
  put(body, "Things to avoid", a.thingsToAvoid);
  put(body, "Notes", a.notes);
  if (said(a.scheduleMeeting) && !isNo(a.scheduleMeeting)) {
    body.push("The client asked to schedule a meeting before work begins.");
  }
  return { specs, body };
}

/**
 * What we asked and they didn't answer.
 *
 * ⚠️ It used to mean "every blank in a hardcoded list of 12", which is why the
 * task brief listed a copywriting job as missing its dimensions and animation.
 * It now intersects with the questions this submission was actually SHOWN —
 * and `fieldsAsked` falls back to asking everything for a submission with no
 * kind, which is precisely what those older submissions were asked.
 *
 * Kept for the notification email only: a heads-up legitimately wants to say
 * what to chase, whereas the task brief never did — Nitsan deleted this block
 * from all three of the briefs he hand-edited.
 */
function missingFields(a: IntakeAnswers): string[] {
  const asked = new Set(fieldsAsked(a.kinds ?? []));
  return FIELD_LABELS.filter(([key]) => asked.has(key) && !said(a[key] as string)).map(
    ([, label]) => label,
  );
}

/**
 * Plain-text brief (rendered with pre-wrap in the panel).
 *
 * `attach` omitted → no FILES/LINKS blocks. See `BriefAttachments`.
 */
export function assembleTaskBrief(a: IntakeAnswers, attach?: BriefAttachments): string {
  const { specs, body } = briefParts(a);
  // Blocks are joined by a blank line. The specs are short, so they sit tight
  // together as one block; every body entry is its own, because a Creative
  // direction routinely runs to several paragraphs of the client's own text and
  // would otherwise run into the line after it.
  const blocks: string[] = [];
  if (specs.length) blocks.push(specs.join("\n"));
  blocks.push(...body);

  // ⚠️ No company suffix. It is the Client chip on the task, and it survived
  // only one of the three hand-edits. The person and their address are what
  // nobody can look up from the task itself.
  const who = [val(a.name), val(a.email) && `<${val(a.email)}>`].filter(Boolean).join(" ");
  if (who) blocks.push(`Submitted by ${who}`);

  // Attachments are listed ONLY on the submission's own copy — see
  // `BriefAttachments`. The approved task's brief omits them, because by then
  // they are real rows.
  if (attach?.files.length) {
    blocks.push(["FILES", ...attach.files.map((f) => `• ${f.name}: ${f.url}`)].join("\n"));
  }
  if (attach?.links.length) {
    blocks.push(["LINKS", ...attach.links.map((l) => `• ${l.title}: ${l.url}`)].join("\n"));
  }
  if (attach?.dropped?.length) {
    blocks.push(
      ["FILES THAT DID NOT ARRIVE", ...attach.dropped.map((d) => `• ${d}`)].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

/**
 * Reads back what `task_requests.answers` stored, for surfaces that need the
 * parts rather than the assembled text — `approveRequest` turning the files and
 * links into real `links` rows, above all.
 *
 * Returns null for a row submitted before 0003 added the column, whose only
 * record is the assembled `brief` string. ⚠️ Every field is re-checked rather
 * than cast: this is a jsonb column, so its shape is whatever was written on
 * the day, and a `.map` over something that isn't an array is a crash on the
 * intake queue — the one page whose whole job is to survive bad input.
 */
export function readSubmission(
  answers: Record<string, unknown> | null | undefined,
): { answers: IntakeAnswers; files: IntakeFile[]; links: BriefLink[] } | null {
  if (!answers || typeof answers !== "object") return null;
  const str = (k: string) => {
    const v = (answers as Record<string, unknown>)[k];
    return typeof v === "string" ? v : "";
  };
  // A title/url pair, from either shape: files carry `name`, links carry `title`.
  const pairs = (k: string): { title: string; url: string }[] => {
    const v = (answers as Record<string, unknown>)[k];
    if (!Array.isArray(v)) return [];
    return v.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url : "";
      const title =
        (typeof r.title === "string" && r.title) || (typeof r.name === "string" && r.name) || "";
      return url ? [{ title: title || url, url }] : [];
    });
  };
  // ⚠️ Accepts the old single `kind` string as well as the current list — the
  // first submissions through the stepped form stored one, and a jsonb column
  // keeps whatever was written on the day.
  const kinds = (): string[] => {
    const v = (answers as Record<string, unknown>).kinds;
    if (Array.isArray(v)) return v.filter((k): k is string => typeof k === "string" && !!k);
    const one = (answers as Record<string, unknown>).kind;
    return typeof one === "string" && one ? [one] : [];
  };
  // ⚠️ Same defensiveness as `pairs`: this is a jsonb column, so its shape is
  // whatever was written on the day. A row with no deliverables (every
  // submission before the stepped form) yields [], never undefined-with-a-map.
  const deliverables = (): Deliverable[] => {
    const v = (answers as Record<string, unknown>).deliverables;
    if (!Array.isArray(v)) return [];
    return v.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const details = typeof r.details === "string" ? r.details.trim() : "";
      return name || details ? [{ name, details }] : [];
    });
  };
  return {
    answers: {
      name: str("name"),
      email: str("email"),
      company: str("company"),
      taskName: str("taskName"),
      techNotes: str("techNotes"),
      kinds: kinds(),
      deliverables: deliverables(),
      dimensions: str("dimensions"),
      format: str("format"),
      animated: str("animated"),
      dueDate: str("dueDate"),
      budgetRange: str("budgetRange"),
      creativeBrief: str("creativeBrief"),
      goal: str("goal"),
      displayedWhere: str("displayedWhere"),
      targetAudience: str("targetAudience"),
      thingsToAvoid: str("thingsToAvoid"),
      content: str("content"),
      notes: str("notes"),
      scheduleMeeting: str("scheduleMeeting"),
    },
    files: pairs("files").map((p) => ({ name: p.title, url: p.url })),
    links: pairs("links"),
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML notification email, in the studio's established format. */
export function assembleEmailHtml(
  a: IntakeAnswers,
  attach: BriefAttachments,
  reviewUrl: string,
): string {
  const { files, links, dropped } = attach;
  const missing = missingFields(a);
  const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");
  const { specs, body } = briefParts(a);
  return `
<h2 style="margin:0 0 4px">New task submission — ${escapeHtml(orNP(a.company))}</h2>
<p style="margin:0 0 16px;color:#5c6478">"${escapeHtml(orNP(a.taskName))}" from ${escapeHtml(orNP(a.name))} &lt;${escapeHtml(a.email)}&gt;</p>

<div style="background:#f3f4f6;padding:14px;border-radius:8px;line-height:1.5;">
${[...specs, ...body].map((p) => `<p style="margin:0 0 12px">${nl2br(p)}</p>`).join("\n")}
</div>
${missing.length ? `<h3>Not answered</h3><p style="color:#5c6478">${missing.map(escapeHtml).join("<br>")}</p>` : ""}
${files.length ? `<h3>Files</h3><p>${files.map((f) => anchor(f.url, f.name)).join("<br>")}</p>` : ""}
${links.length ? `<h3>Links</h3><p>${links.map((l) => anchor(l.url, l.title)).join("<br>")}</p>` : ""}
${dropped?.length ? `<h3 style="color:#b91c1c">Files that did not arrive</h3><p style="color:#b91c1c">${dropped.map(escapeHtml).join("<br>")}</p>` : ""}
<p style="margin-top:20px"><a href="${escapeHtml(reviewUrl)}" style="background:#0b43ed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Review in Studio&more</a></p>
`;
}

/**
 * ⚠️ The URL is escaped too, not just the label. It goes inside a quoted
 * attribute, so a `"` anywhere in it closes the attribute early and everything
 * after becomes markup — and these URLs are client-supplied.
 */
function anchor(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label || url)}</a>`;
}

/**
 * The read-receipt sent TO THE CLIENT when an admin has seen their submission.
 *
 * The wording is EDITABLE from Settings (`app_settings.intake_seen_email`) —
 * this is the only mail in the app that goes to someone outside the studio, so
 * it is the one whose tone the studio should own without a deploy. What follows
 * is the default, used until somebody changes it.
 *
 * ⚠️ It says almost nothing on purpose, and an edit shouldn't change that: it
 * confirms one fact — a person has read the brief — and must not imply the work
 * is scheduled, priced or agreed, none of which has happened when it is sent.
 */
export interface SeenEmailTemplate {
  subject: string;
  /** Plain text. Blank lines separate paragraphs; `{…}` placeholders below. */
  body: string;
}

export const SEEN_EMAIL_DEFAULT: SeenEmailTemplate = {
  subject: "We've got your brief — {task}",
  body: `Hi {firstName},

Just to let you know your brief — {task} — reached us and someone at the studio has read it.

We'll come back to you shortly with next steps. No need to do anything in the meantime.

— {studio}`,
};

/** The placeholders, with what to show for each in the Settings preview. */
export const SEEN_EMAIL_PLACEHOLDERS: { token: string; describes: string; sample: string }[] = [
  { token: "{firstName}", describes: "the sender's first name", sample: "Dana" },
  { token: "{name}", describes: "their full name", sample: "Dana Levi" },
  { token: "{task}", describes: "what they called the task", sample: "Instagram launch set" },
  { token: "{company}", describes: "the company they gave", sample: "Northwind" },
  { token: "{studio}", describes: "the studio's name", sample: "Studio&more" },
];

export interface SeenEmailVars {
  submitterName: string;
  taskName: string;
  company?: string;
  studioName?: string;
}

function fillTokens(text: string, v: SeenEmailVars): string {
  const name = v.submitterName.trim();
  const values: Record<string, string> = {
    "{firstName}": name.split(/\s+/)[0] || "there",
    "{name}": name || "there",
    "{task}": v.taskName.trim(),
    "{company}": (v.company ?? "").trim(),
    "{studio}": v.studioName || "Studio&more",
  };
  return text.replace(/\{(firstName|name|task|company|studio)\}/g, (m) => values[m] ?? m);
}

/**
 * Renders a template to what Resend is actually given.
 *
 * ⚠️ Substitution happens BEFORE escaping, and the escape covers the whole
 * result. Doing it the other way — escaping the template, then splicing in raw
 * values — is how a client whose company is written `Smith & Sons` ends up
 * mailed as `Smith &amp; Sons`, and how a task title containing a `<` silently
 * eats the rest of the paragraph.
 *
 * The subject is NOT escaped: it is a header, not markup. It is stripped of
 * newlines instead, which is the injection that matters there.
 */
export function renderSeenEmail(
  template: SeenEmailTemplate | null | undefined,
  vars: SeenEmailVars,
): { subject: string; html: string } {
  const t = {
    subject: template?.subject?.trim() || SEEN_EMAIL_DEFAULT.subject,
    body: template?.body?.trim() || SEEN_EMAIL_DEFAULT.body,
  };
  const subject = fillTokens(t.subject, vars)
    .replace(/[\r\n]+/g, " ")
    // An empty task name leaves "We've got your brief — " trailing a dash.
    .replace(/[\s—–-]+$/, "")
    .trim()
    .slice(0, 200);

  const html = fillTokens(t.body, vars)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return { subject: subject || SEEN_EMAIL_DEFAULT.subject, html };
}

/** "6", "6h", "5-8 hours" → a number of hours (upper bound of a range) or null. */
export function parseBudgetHours(budgetRange: string): number | null {
  const nums = (budgetRange.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  return Math.max(...nums);
}
