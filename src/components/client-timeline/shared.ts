"use client";

// Geometry, types and the drag/tree helpers the whole Gantt shares.
//
// Everything here is either a MEASUREMENT with a reason written beside it or a
// shape the row, header and layer modules all have to agree on. It is split out
// so those files can be read one at a time without the constants scrolling past
// first — not because any of it is generic: every number in here was arrived at
// by looking at the real chart.
//
// ⚠️ `dragRow` is module state ON PURPOSE and must stay module-scoped: a row
// component reads it to decide whether to accept a drop, so a ref inside the
// chart could not reach it without threading a prop through every row. See the
// note on the const itself.

import { SECTION_H, TIP_H } from "@/lib/gantt";
import type { Profile, Section, Task, TaskGroup, TaskType } from "@/lib/types";

export const GRIP_W = 16;

export const CHECK_W = 22;

export const NAME_W = 200;

/** Just the face, but its own column now that clicking it reassigns the task. */
export const ASSIGNEE_W = 44;

/** Dot + name. 96 fits "Presentation" — the longest type the studio uses. */
export const TYPE_W = 96;

export const DATES_W = 104;

/** 72, not 68: at 68 the word "Duration" in the header clipped by exactly 1px. */
export const DURATION_W = 72;

export const HOURS_W = 56;


/**
 * ONLY this block sticks while the chart scrolls sideways.
 *
 * Pinning the whole left table (566px) meant that on a laptop half the visible
 * width was permanently spent on columns you weren't reading. The task name is
 * the one thing a row is useless without, so grip + checkbox + name hold their
 * place and everything else scrolls away with the calendar.
 */
export const STICKY_W = GRIP_W + CHECK_W + NAME_W;


/**
 * The pinned header's shadow, applied only when rows are hidden above it. The
 * negative spread confines it to the bottom edge; without it the shadow would
 * also smear sideways across the column titles.
 *
 * The horizontal counterpart is NOT a class: it is one full-height gradient in
 * the scroller (see the `shadow.x` layer), because a per-row box-shadow came out
 * broken by every row border it crossed.
 */
export const SHADOW_Y = "shadow-[0_5px_8px_-6px_rgba(0,0,0,0.14)]";


/**
 * The row hover tint, in two forms.
 *
 * ⚠️ The pinned blocks need an OPAQUE one. `bg-background/40` replaces
 * `bg-surface` rather than layering over it — they are both background-colour
 * utilities — so on hover the sticky column turned 40% transparent and the
 * calendar scrolling underneath showed through the task's own name: grid lines
 * struck through the text and weekend shading appeared behind it. `color-mix`
 * gives the same colour as a solid.
 *
 * The chart area keeps the translucent one on purpose: it paints OVER the grid
 * layer, and an opaque tint there would blank that row's shading and rules.
 */
export const ROW_HOVER_SOLID =
  "group-hover/trow:bg-[color-mix(in_srgb,var(--color-background)_40%,var(--color-surface))]";

/**
 * ⚠️ The chart side needs a DARK wash, not the pinned side's light one.
 * `bg-background/40` over the chart canvas — which is itself `bg-background` —
 * is the same colour, so the hover tint was invisible from the moment it
 * reached the calendar. A wash of the foreground reads on both.
 *
 * Both of these are translucent on purpose: the rows paint OVER the grid layer,
 * so an opaque tint blanks that row's day rules, week seams and weekend
 * shading. Selecting five tasks used to erase the calendar underneath them.
 */
export const ROW_HOVER_SHEER = "group-hover/trow:bg-foreground/[0.06]";

export const ROW_SELECTED_SHEER = "bg-brand/[0.12]";


/**
 * The section bracket's colour.
 *
 * The client's own colour made every section on a client's chart the same
 * bright hue — Anchor's magenta ran across the whole plan — competing with the
 * type colours that actually distinguish one bar from another. A section is
 * structure, not a category, so it is drawn as ink.
 */
export const SECTION_BAR_COLOR = "color-mix(in srgb, var(--foreground) 72%, transparent)";

/**
 * A group's bar, and the shims stacked behind it — brand blue, at Nitsan's call
 * (it read as black before, which put the heaviest mark on the chart on the one
 * row that isn't work).
 *
 * ⚠️ Still NOT a task type's colour. A group has no type, and the type colours
 * are the one key the legend explains, so a bar in one of them promises it means
 * what the legend says. Brand blue belongs to the app rather than to any
 * category, which is exactly the register a container wants.
 *
 * ⚠️ The shims are OPAQUE, not a faded copy — also his call. At 45%/35% they
 * read as a rendering artefact behind the bar rather than as more bars; solid
 * steps down toward the brand's own light tint read as a stack of cards.
 */
export const GROUP_BAR_COLOR = "var(--group-bar)";

/**
 * The shims, FURTHEST first — solid colours stepping from the bar toward the
 * row's own surface, so the stack tapers without ever going translucent.
 *
 * ⚠️ Mixed with `--surface`, not lightened with a fixed white: under `night`
 * the surface is near-black, so the steps go darker there instead of lighter and
 * the stack still reads. There is no `--brand-light` token; these are the mix.
 */
/**
 * Where the OPEN group's rule sits in its row: low, so the name has the space
 * above it — the same reasoning that made `SECTION_H` 36 rather than 30.
 */
export const GROUP_LINE_TOP = 22;

/**
 * How far a group's task rows sit in from the section's own rows, so "inside a
 * group" and "loose in the section" are told apart at a glance rather than by
 * reading the heading above them.
 *
 * ⚠️ Only the group's CHILDREN move. A loose task and a group are siblings, so
 * aligning them exactly would be more correct still — but that would re-indent
 * every row on every client's chart for a feature most sections don't use, so
 * the smaller change is the one that ships. Say the word.
 */
export const TL_INDENT = 14;

export const GROUP_LAYER_COLORS = [
  "color-mix(in srgb, var(--group-bar) 38%, var(--surface))",
  "color-mix(in srgb, var(--group-bar) 62%, var(--surface))",
];

/**
 * How far down its row the bracket sits.
 *
 * Low on purpose: centred, it split the row in two and left the section's name
 * squeezed into 12px above it. Dropped to the bottom — its tips end 3px clear
 * of the row's edge — the whole top of the row belongs to the name.
 */
export const SECTION_BAR_TOP = SECTION_H - TIP_H - 3;


/**
 * A bar's own shadow: soft, two layers, barely there.
 *
 * A tight 2px shadow at 18% drew a dark line under every bar — 57 of them on a
 * chart like Anchor's, which reads as grime rather than as lift. A close, faint
 * layer for contact and a wider, softer one for the glow does the same job
 * without ever resolving into an edge.
 *
 * Enough to sit the bar ON the calendar rather than in it: the grid, the weekend
 * shading and the past wash all live behind it.
 */
export const BAR_SHADOW = [
  "0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent)",
  "0 2px 8px color-mix(in srgb, var(--foreground) 10%, transparent)",
].join(", ");


/** Half-width and depth of the today tag's tail, in one number. */
export const TODAY_TAIL = 5;


/**
 * The pinned ruler's height — one `h-6` row plus its bottom border. Milestone
 * labels stick just below it, so scrolling down never leaves a line unnamed.
 */
export const RULER_H = 25;


/** Never shrink the chart below this, however little room the page leaves. */
export const CARD_MIN_H = 320;

/** `main`'s own bottom padding (p-6), so the card stops clear of the edge. */
export const CARD_BOTTOM_GAP = 24;


/** The optional left-table columns, in order, with their widths. */
export const TL_COLS = [
  { key: "who", label: "Who", w: ASSIGNEE_W, title: "Assignee" },
  { key: "type", label: "Type", w: TYPE_W, title: "Kind of work — this is what colours the bar" },
  { key: "dates", label: "Dates", w: DATES_W, title: "Start and due dates" },
  {
    key: "duration",
    label: "Duration",
    w: DURATION_W,
    title: "Working days — Fri/Sat and studio holidays don't count",
  },
  { key: "actual", label: "Actual", w: HOURS_W, title: "Hours logged so far" },
  { key: "budget", label: "Budget", w: HOURS_W, title: "Budgeted hours" },
] as const;

export type TlCol = (typeof TL_COLS)[number]["key"];

export const TL_COL_KEYS = TL_COLS.map((c) => c.key) as TlCol[];


/** Left-table width for a given hidden set. The name block is never optional. */
export function leftWidth(hidden: Set<string>): number {
  return TL_COLS.reduce((w, c) => w + (hidden.has(c.key) ? 0 : c.w), STICKY_W);
}


/** Below this the "12/24h" label doesn't fit and is dropped rather than clipped. */
export const LABEL_MIN_PX = 64;

/**
 * Resize handles are 8px a side. Below this the two cover the whole bar and
 * there is nothing left to grab for a move — at week zoom a one-day bar is 9px.
 * Narrower bars are move-only.
 */
export const HANDLE_MIN_PX = 30;

/**
 * Where the label switches from dark to white. The label starts at the bar's
 * left edge and so does the hours fill, so past roughly half the bar the label
 * is sitting on solid colour rather than on the tinted track.
 */
export const LABEL_ON_FILL_PCT = 55;

/**
 * Measured height of the Dates popover (title + two fields + the button row).
 * Used to decide whether it opens downwards or flips above the cell — it is
 * `fixed`, so nothing else stops it running off the bottom of the window.
 */
export const PANEL_H = 200;


/** What's being dragged and by how much — held locally so a drag is one write, not sixty. */
export interface DragState {
  taskId: string;
  mode: "move" | "start" | "end";
  startX: number;
  deltaDays: number;
  /** distinguishes a click (open the task) from a drag (re-schedule it) */
  moved: boolean;
  /**
   * Every task this drag moves, when it started on a bar that was part of a
   * multi-selection. `null` for an ordinary one-bar drag.
   *
   * MOVE only. Dragging an edge stays single: resizing ten tasks by the same
   * number of days is a different intent from moving them, and one nobody asked
   * for — a 2-day task and a 3-week task do not want the same edge nudge.
   */
  group: string[] | null;
}


export interface Row {
  task: Task;
  start: Date;
  due: Date;
  /** false = a deadline with no span; drawn as a diamond, not a bar */
  hasStart: boolean;
  /** no dates at all — listed so it can be scheduled, but nothing is drawn */
  undated: boolean;
  doneMinutes: number;
  assignee: Profile | null;
  type: TaskType | null;
}


/** A subject group and the rows inside it (0027). */
export interface Block {
  group: TaskGroup;
  rows: Row[];
  /** The span its rows cover — what the stacked bar draws. */
  start: Date;
  due: Date;
  /** True when not one of its rows is dated, so there is no bar to draw. */
  undated: boolean;
}


export interface Group {
  /** null = the tasks with no section */
  section: Section | null;
  /** The section's LOOSE rows — its tasks that aren't in a group. */
  rows: Row[];
  /** Its subject groups, in position order. Rendered above the loose rows. */
  blocks: Block[];
  start: Date;
  due: Date;
  /** Nothing in it is dated, so there is no bracket to draw. */
  undated: boolean;
}


/** Every row in a section, groups' children included — for counts and windows. */
export function allRowsOf(g: Group): Row[] {
  return [...g.blocks.flatMap((b) => b.rows), ...g.rows];
}


/**
 * The row currently being dragged, and the CONTAINER it came from — its section
 * AND its group (0027). Reordering is confined to one container, so this has to
 * name both: a row dragged out of a group onto a loose row is a container
 * change, and `reorderTimelineTasks` would otherwise renumber a list the row
 * isn't in.
 *
 * ⚠️ Module-scoped, and ONE OBJECT rather than two `let`s. It has to be module
 * scope because `TimelineRow` — a separate component — reads it to decide
 * whether to accept a drop, so a ref inside `ClientTimeline` could not reach it
 * without threading a prop through every row. It is an object because the React
 * Compiler lint refuses a module variable that is REASSIGNED from a component
 * (`react-hooks/globals`): assigning fields of a stable const is the same drag
 * state without the rule violation. Not render state — nothing reads it during
 * render, only drag handlers.
 */
export const dragRow: { id: string | null; fromContainer: string | null } = {
  id: null,
  fromContainer: null,
};


/**
 * Written and cleared through functions rather than assigned in place.
 *
 * ⚠️ Not ceremony — the React Compiler lint treats a component that reassigns or
 * mutates module state as impure (`react-hooks/globals`, then
 * `react-hooks/immutability`). Doing it in a plain function declared out here
 * keeps the handlers honest and the gate at zero errors, with no behaviour
 * change: this is drag state, read only by handlers, never during render.
 */
export function beginRowDrag(id: string, fromContainer: string): void {
  dragRow.id = id;
  dragRow.fromContainer = fromContainer;
}


export function endRowDrag(): { id: string | null; fromContainer: string | null } {
  const was = { id: dragRow.id, fromContainer: dragRow.fromContainer };
  dragRow.id = null;
  dragRow.fromContainer = null;
  return was;
}


/** How a container is named in `dragRow.fromContainer` and the collapse set. */
export function containerKey(sectionId: string | null, groupId: string | null): string {
  return `${sectionId ?? ""}|${groupId ?? ""}`;
}

/** How the collapse set names a group, kept apart from section keys. */
export function blockKey(groupId: string): string {
  return `g:${groupId}`;
}


export function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

export function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

