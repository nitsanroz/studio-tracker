// Turns intake-form answers into a design brief, following the studio's
// established digest rules: never invent information, mark gaps as
// "Not provided", budgets are hours unless stated otherwise.

export interface IntakeAnswers {
  name: string;
  email: string;
  company: string;
  taskName: string;
  dimensions: string;
  format: string;
  animated: string;
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

function summaryText(a: IntakeAnswers): string {
  const parts: string[] = [];
  parts.push(
    `${val(a.company) || "A client"} requests "${val(a.taskName) || "a new task"}"` +
      (val(a.format) ? ` — format: ${val(a.format)}` : "") +
      (val(a.dimensions) ? ` (${val(a.dimensions)})` : "") +
      (val(a.animated) ? `, animated: ${val(a.animated)}` : "") +
      (val(a.dueDate) ? `, due ${val(a.dueDate)}` : "") +
      ".",
  );
  if (val(a.goal)) parts.push(`Goal: ${val(a.goal)}`);
  if (val(a.targetAudience)) parts.push(`Target audience: ${val(a.targetAudience)}`);
  if (val(a.displayedWhere)) parts.push(`Displayed at: ${val(a.displayedWhere)}`);
  if (val(a.creativeBrief)) parts.push(`Creative direction: ${val(a.creativeBrief)}`);
  if (val(a.content)) parts.push(`Content: ${val(a.content)}`);
  if (val(a.scheduleMeeting) && !/^no/i.test(val(a.scheduleMeeting)))
    parts.push(`The client asked to schedule a meeting before work begins.`);
  return parts.join("\n\n");
}

function missingFields(a: IntakeAnswers): string[] {
  return FIELD_LABELS.filter(([key]) => !val(a[key])).map(([, label]) => label);
}

/**
 * Plain-text brief (rendered with pre-wrap in the panel).
 *
 * `attach` omitted → no FILES/LINKS blocks. See `BriefAttachments`.
 */
export function assembleTaskBrief(a: IntakeAnswers, attach?: BriefAttachments): string {
  const missing = missingFields(a);
  const sections = [
    "SUMMARY",
    summaryText(a),
    "",
    "TASK DESCRIPTION",
    `Dimensions: ${orNP(a.dimensions)}`,
    `Budget: ${val(a.budgetRange) ? `${val(a.budgetRange)} (hours unless otherwise specified)` : "Not provided"}`,
    `Things to avoid: ${orNP(a.thingsToAvoid)}`,
    `Notes: ${orNP(a.notes)}`,
    "",
    `Submitted by ${val(a.name)} <${val(a.email)}>${val(a.company) ? ` — ${val(a.company)}` : ""}`,
  ];
  if (missing.length) {
    sections.push("", "MISSING INFORMATION", ...missing.map((m) => `• ${m}`));
  }
  if (attach?.files.length) {
    sections.push("", "FILES", ...attach.files.map((f) => `• ${f.name}: ${f.url}`));
  }
  if (attach?.links.length) {
    sections.push("", "LINKS", ...attach.links.map((l) => `• ${l.title}: ${l.url}`));
  }
  return sections.join("\n");
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
  return {
    answers: {
      name: str("name"),
      email: str("email"),
      company: str("company"),
      taskName: str("taskName"),
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
  const { files, links } = attach;
  const missing = missingFields(a);
  const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");
  return `
<h2 style="margin:0 0 4px">New task submission — ${escapeHtml(orNP(a.company))}</h2>
<p style="margin:0 0 16px;color:#5c6478">"${escapeHtml(orNP(a.taskName))}" from ${escapeHtml(orNP(a.name))} &lt;${escapeHtml(a.email)}&gt;</p>

<h3>🧠 AI Summary</h3>
<div style="background:#f3f4f6;padding:14px;border-radius:8px;line-height:1.5;">
${nl2br(summaryText(a))}
</div>

<h3>📋 Task Description</h3>
<p>
<b>Dimensions:</b> ${nl2br(orNP(a.dimensions))}<br><br>
<b>Budget:</b> ${nl2br(orNP(a.budgetRange))}<br><br>
<b>Things to Avoid:</b> ${nl2br(orNP(a.thingsToAvoid))}<br><br>
<b>Notes:</b> ${nl2br(orNP(a.notes))}
</p>
${missing.length ? `<h3>Missing Information</h3><p>${missing.map(escapeHtml).join("<br>")}</p>` : ""}
${files.length ? `<h3>Files</h3><p>${files.map((f) => anchor(f.url, f.name)).join("<br>")}</p>` : ""}
${links.length ? `<h3>Links</h3><p>${links.map((l) => anchor(l.url, l.title)).join("<br>")}</p>` : ""}
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
