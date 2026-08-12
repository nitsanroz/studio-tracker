// What the client intake form asks, as DATA rather than as JSX.
//
// ⚠️ This module exists because the form used to be hardcoded markup, and the
// question set had to be kept in lockstep by hand across the form, the
// `IntakeAnswers` interface, the missing-field labels and two assemblers. One
// of them always drifted. Now the form renders from `WORK_KINDS`, and anything
// that needs to know "what was this client actually asked?" reads the same
// table — which is the only way `MISSING INFORMATION` can honestly mean "what
// we asked and you didn't answer" rather than "every blank in a fixed list".
//
// ⚠️ It deliberately introduces NO new questions. The kinds only decide which
// of the existing ones are shown. The archive of 49 real submissions says the
// questions are broadly right; the problem was asking every one of them of
// every client — a copywriting job being asked about animation, a LinkedIn post
// asked for print dimensions.

import type { IntakeAnswers } from "./brief";

/** A question the form can ask. `key` is the `IntakeAnswers` field it fills. */
export interface IntakeField {
  key: keyof IntakeAnswers;
  label: string;
  type: "text" | "textarea" | "select" | "date";
  placeholder?: string;
  options?: string[];
  rows?: number;
  /** Only Name, Email and Task Name are ever required. */
  required?: boolean;
}

export const FIELDS: Record<string, IntakeField> = {
  name: { key: "name", label: "Name", type: "text", required: true },
  email: { key: "email", label: "Email", type: "text", required: true },
  company: { key: "company", label: "Company", type: "text" },
  taskName: { key: "taskName", label: "Task name", type: "text", required: true },
  dueDate: { key: "dueDate", label: "Due date", type: "date" },
  budgetRange: {
    key: "budgetRange",
    label: "Budget",
    type: "text",
    // ⚠️ NOT "(hours)". Real answers in the archive are prose — "As much as it
    // needs to take", "need a pricing on each bundle" — and they are worth
    // keeping, so the label must not imply a number is wanted.
    placeholder: "e.g. 5-8 hours, or tell us what you're working with",
  },
  format: { key: "format", label: "Format", type: "text", placeholder: "e.g. PNG, Figma, PDF…" },
  dimensions: {
    key: "dimensions",
    label: "Dimensions / technical specs",
    type: "text",
    placeholder: "e.g. 1920×1080, A4, 85 × 200 cm",
  },
  animated: {
    key: "animated",
    label: "Should it be animated?",
    type: "select",
    options: ["Yes", "No", "Not sure yet"],
  },
  techNotes: {
    key: "techNotes",
    label: "Anything else about the specs?",
    type: "textarea",
    rows: 2,
    placeholder: "Print finish, file naming, where it has to fit — anything that doesn't fit above",
  },
  creativeBrief: {
    key: "creativeBrief",
    label: "The brief",
    type: "textarea",
    rows: 5,
    placeholder: "What are we making? Describe it however is natural.",
  },
  goal: { key: "goal", label: "What's the goal?", type: "textarea", rows: 2 },
  displayedWhere: {
    key: "displayedWhere",
    label: "Where will it be used?",
    type: "textarea",
    rows: 2,
    placeholder: "e.g. LinkedIn, the careers page, an event booth",
  },
  targetAudience: { key: "targetAudience", label: "Who's it for?", type: "textarea", rows: 2 },
  content: {
    key: "content",
    label: "Copy or content",
    type: "textarea",
    rows: 3,
    placeholder: "Any text that has to appear",
  },
  thingsToAvoid: { key: "thingsToAvoid", label: "Anything to avoid?", type: "textarea", rows: 2 },
  notes: { key: "notes", label: "Notes", type: "textarea", rows: 2 },
  scheduleMeeting: {
    key: "scheduleMeeting",
    label: "Want to talk it through before we start?",
    type: "select",
    options: ["No", "Yes"],
  },
};

/**
 * A kind of work, in the client's language.
 *
 * ⚠️ These are CLIENT-facing and map to nothing internally. An earlier design
 * had them setting the task's Type; Nitsan assigns Type himself, so the kinds
 * do exactly one job — decide which questions get asked — and there is no
 * mapping to keep in sync when a task type is renamed or deleted.
 *
 * ⚠️ The list is DERIVED from the studio's 49 archived submissions, not
 * invented: clustering the real task names put 48 of 49 into these eight, with
 * social posts (15) and website work (9) the two biggest by a distance.
 */
export interface WorkKind {
  id: string;
  label: string;
  /** One line under the label, to make the choice obvious. */
  hint: string;
  /** Carries the meaning at a glance; never the only signal (see the label). */
  icon: string;
  /** Which of `FIELDS` this kind asks, beyond the always-asked ones. */
  asks: (keyof IntakeAnswers)[];
  /** Does this kind routinely arrive as several named pieces? */
  deliverables?: boolean;
}

/** Asked of everyone, whatever the kind. */
export const ALWAYS_ASKS: (keyof IntakeAnswers)[] = [
  "taskName",
  "dueDate",
  "budgetRange",
  "creativeBrief",
  "goal",
  "displayedWhere",
  "targetAudience",
];

/**
 * Asked on the Technical details step whatever the kind.
 *
 * ⚠️ A deliberate catch-all. Nitsan's note: "always a comments field to fill
 * what's not obvious where it goes". Every structured question is a guess about
 * what a client needs to say, and this is the box for everything the guess
 * missed — without it that material gets wedged into whichever field looks
 * closest, where it reads as an answer to a question nobody asked.
 */
export const TECH_ALWAYS: (keyof IntakeAnswers)[] = ["techNotes"];

/** Asked of everyone, on the final optional step. */
export const CLOSING_ASKS: (keyof IntakeAnswers)[] = [
  "thingsToAvoid",
  "notes",
  "scheduleMeeting",
];

export const WORK_KINDS: WorkKind[] = [
  {
    id: "social",
    icon: "💬",
    label: "Social post or banner",
    hint: "LinkedIn, Instagram, X — posts, headers, campaign sets",
    // `animated` survives here rather than being cut. It earned one useful
    // answer in 49 — but 43 of those were static web and print pieces where it
    // never applied. On a social set or a video loop it is a real question.
    asks: ["format", "dimensions", "animated", "content"],
    deliverables: true,
  },
  {
    id: "website",
    icon: "🖥️",
    label: "Website page or asset",
    hint: "A new page, a redesign, hero images, section graphics",
    asks: ["format", "dimensions", "content"],
    deliverables: true,
  },
  {
    id: "event",
    icon: "🎪",
    label: "Event, booth or signage",
    hint: "Booth graphics, roll-ups, banners, billboards, screens",
    asks: ["format", "dimensions", "animated", "content"],
    deliverables: true,
  },
  {
    id: "presentation",
    icon: "📊",
    label: "Presentation or deck",
    hint: "Slides for a meeting, a template, a rebuild",
    asks: ["format", "dimensions", "content"],
  },
  {
    id: "document",
    icon: "📄",
    label: "Document",
    hint: "Whitepaper, case study, one-pager, report",
    asks: ["format", "dimensions", "content"],
  },
  {
    id: "graphics",
    icon: "📈",
    label: "Graphics or data visualisation",
    hint: "Charts, diagrams, benchmark graphs, illustrations",
    asks: ["format", "dimensions", "animated"],
    deliverables: true,
  },
  {
    id: "swag",
    icon: "👕",
    label: "Swag or merchandise",
    hint: "T-shirts, socks, stickers, cards, printed giveaways",
    asks: ["format", "dimensions", "content"],
    deliverables: true,
  },
  {
    id: "logo",
    icon: "✨",
    label: "Logo or brand asset",
    hint: "A new mark, an event logo, brand elements",
    asks: ["format", "dimensions"],
  },
  {
    id: "other",
    icon: "🧩",
    label: "Something else",
    hint: "Not sure which of these fits — tell us in the brief",
    // The catch-all asks everything, since we know nothing about it.
    asks: ["format", "dimensions", "animated", "content"],
    deliverables: true,
  },
];

export function kindById(id: string): WorkKind | undefined {
  return WORK_KINDS.find((k) => k.id === id);
}

/**
 * Every field this submission was actually shown, in form order.
 *
 * ⚠️ This is what makes "not answered" honest. An unknown or missing kind — an
 * archived submission from before kinds existed, or a hand-edited row — falls
 * back to asking everything, which is exactly what those older submissions
 * were asked.
 */
export function fieldsAsked(kindIds: string[] | string): (keyof IntakeAnswers)[] {
  const ids = Array.isArray(kindIds) ? kindIds : [kindIds];
  const kinds = ids.map(kindById).filter(Boolean) as WorkKind[];
  // ⚠️ The UNION, not the intersection. One task can hold a roll-up and a
  // social post, and a question relevant to either is relevant to the brief.
  const asks = kinds.length
    ? [...new Set(kinds.flatMap((k) => k.asks))]
    : (kindById("other")!.asks as (keyof IntakeAnswers)[]);
  return [...ALWAYS_ASKS, ...asks, ...TECH_ALWAYS, ...CLOSING_ASKS];
}

/** Do any of the chosen kinds routinely arrive as several named pieces? */
export function wantsDeliverables(kindIds: string[]): boolean {
  return kindIds.some((id) => kindById(id)?.deliverables);
}
