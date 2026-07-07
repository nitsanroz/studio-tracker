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

/** Plain-text brief stored on the task (rendered with pre-wrap in the panel). */
export function assembleTaskBrief(a: IntakeAnswers, files: IntakeFile[]): string {
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
  if (files.length) {
    sections.push("", "FILES", ...files.map((f) => `• ${f.name}: ${f.url}`));
  }
  return sections.join("\n");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML notification email, in the studio's established format. */
export function assembleEmailHtml(a: IntakeAnswers, files: IntakeFile[], reviewUrl: string): string {
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
${files.length ? `<h3>Files</h3><p>${files.map((f) => `<a href="${f.url}">${escapeHtml(f.name)}</a>`).join("<br>")}</p>` : ""}
<p style="margin-top:20px"><a href="${reviewUrl}" style="background:#0b43ed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Review in Studio&more</a></p>
`;
}

/** "6", "6h", "5-8 hours" → a number of hours (upper bound of a range) or null. */
export function parseBudgetHours(budgetRange: string): number | null {
  const nums = (budgetRange.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  return Math.max(...nums);
}
