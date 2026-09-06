"use client";

// Geometry, contexts, column definitions and the drag state the client's task
// views all share.
//
// Split out so the row, group and section modules can be read one at a time
// without this scrolling past first — not because any of it is generic. Every
// number here was arrived at by looking at the real table.
//
// ⚠️ `drag` is module state ON PURPOSE and must stay module-scoped: the element
// deciding whether to accept a drop is a different component from the one being
// dragged, and `dataTransfer` cannot be read during `dragover`. See the note on
// the const itself.

import { createContext, useContext } from "react";


// pl-9 clears the 36px left gutter, which holds BOTH the select checkbox (left-1)
// and the drag handle (left-[18px]) — absolutely positioned, so appearing on hover
// never shifts the row. The gutter was NOT widened to fit the checkbox: the fixed
// columns leave the name cell little room, so every pixel spent here is taken
// straight off the task name. The grip keeps its full row height (the v0.99.27 fix
// for intermittent dragging — the height was what mattered) at half the width.
// The name cell has a min-w-32 floor and the table wrapper is min-w-fit (as on My
// Tasks): widening a resizable column scrolls the table sideways instead of
// crushing the name to a single character.
export const COLS = "flex items-center gap-3 pl-9 pr-4";

/** What `pl-9` in COLS is worth, so an indented row can add to it. */
export const BASE_PL = 36;

/** One level of nesting — a group's rows, and the group's own contents. */
export const INDENT = 18;

/** Applied to the leading cell (the tick, and the header's spacer) so both stay aligned. */
export const LEAD_TIGHT = "-mr-1.5";


/**
 * Multi-select state, shared down to the rows. A context rather than props: the
 * checkbox lives on TaskRow, the select-all on SectionGroup and the table header,
 * and threading four callbacks through both would bury the drag/drop logic that
 * already fills those signatures.
 */
export type SelectionCtx = {
  selected: Set<string>;
  /** Display order of every visible task, for shift-click ranges. */
  ordered: string[];
  toggle: (taskId: string, shiftKey: boolean) => void;
  setMany: (taskIds: string[], on: boolean) => void;
};

export const SelectionContext = createContext<SelectionCtx | null>(null);

export const useSelection = () => useContext(SelectionContext);


/**
 * Drag-resizable column widths, same mechanism as the My Tasks table. A context
 * for the same reason as the selection above: the header owns the drag handles
 * but the widths have to reach TaskRow, which is rendered two levels down
 * through SectionGroup. Defaults are the px equivalents of the Tailwind widths
 * these cells used to carry (w-40 / w-16 / w-28 / w-36); the "$" column stays
 * fixed — it holds one glyph and there is nothing to reveal by widening it.
 */
export const COL_DEFAULTS: Record<string, number> = {
  /**
   * A REAL width, not a floor.
   *
   * The name cell used to be `flex-1` with this as its `minWidth`, and that made
   * both column-resize complaints true at once. Dragging any OTHER column's
   * handle right grew that column out of the name cell's width — total row width
   * was fixed, so the handle stayed under your cursor while the column silently
   * grew to the LEFT: the drag read as backwards. And dragging the name handle
   * did nothing at all, because it moved a minimum that sat far below the width
   * flex had already given the cell.
   *
   * Fixed-width like every other column, the row grows and the wrapper
   * (`min-w-fit`) scrolls sideways instead. Every handle now moves the edge it
   * is sitting on, in the direction you drag it.
   */
  name: 320,
  assignee: 160,
  start: 72,
  due: 72,
  type: 104,
  tag: 112,
  hours: 64,
  // trimmed from 144 now that the logged hours have their own column and this one
  // prints just the budget beside the bar. NOTE: `useColWidths` merges the stored
  // blob OVER these, so anyone with a saved width keeps their old 144.
  budget: 112,
};

export const ColWidthsContext = createContext<Record<string, number>>(COL_DEFAULTS);

/** Width + no-shrink for one column cell, for `style={…}`. */
export function useColCell() {
  const widths = useContext(ColWidthsContext);
  return (key: string) => ({ width: widths[key] ?? COL_DEFAULTS[key], flexShrink: 0 }) as const;
}

/**
 * The name cell. The 160px clamp is for anyone who dragged this handle while it
 * was still a `minWidth`: the drag looked like it did nothing but it DID store a
 * width, so a saved 40 or 128 would suddenly apply the first time they load this
 * version and the column would arrive crushed.
 */
export const NAME_MIN = 160;

export function useNameCell() {
  const widths = useContext(ColWidthsContext);
  return {
    width: Math.max(NAME_MIN, widths.name ?? COL_DEFAULTS.name),
    flexShrink: 0,
  } as const;
}


/**
 * Which optional columns are shown. Eight columns is more than any one person
 * needs at once — someone scheduling wants Start/Due/Type, someone invoicing
 * wants Hours/Budget/$ — so the set is per-user and persisted, like the widths.
 * The task NAME is not in here: a table of tasks with no titles is not a view
 * anyone wants, and leaving it out means the menu can never empty the table.
 */
export const OPTIONAL_COLS = [
  { key: "assignee", label: "Assignee" },
  { key: "start", label: "Start" },
  { key: "due", label: "Due" },
  { key: "type", label: "Type" },
  { key: "tag", label: "Status" },
  { key: "hours", label: "Hours" },
  { key: "budget", label: "Budget" },
  { key: "billable", label: "$ (billable)" },
] as const;

export type ColKey = (typeof OPTIONAL_COLS)[number]["key"];

export const ALL_COLS = OPTIONAL_COLS.map((c) => c.key) as ColKey[];


export const HiddenColsContext = createContext<Set<string>>(new Set());

/** `show("due")` — false when the user has hidden that column. */
export function useShowCol() {
  const hidden = useContext(HiddenColsContext);
  return (key: ColKey) => !hidden.has(key);
}


/** Custom MIME so unrelated drop targets (weekly plan, report table) ignore these
 *  drags — and so `dragover` can tell whether to accept, since getData() is only
 *  readable on drop. */
export const TASK_DRAG_TYPE = "application/x-studio-task-id";


/**
 * What is currently being dragged, mirrored OUTSIDE the DataTransfer.
 *
 * ⚠️ THIS HAS TO BE MODULE STATE. `dataTransfer.getData()` is unreadable during
 * `dragover` — that is the whole reason these ids exist — and the element that
 * must decide whether to accept a drop is a DIFFERENT component from the one
 * being dragged. A row needs to know, while the pointer is still moving, whether
 * this is a reorder within its own section (it handles it) or a move from
 * another section (it lets the group handle it). A ref inside `ClientView` could
 * not reach any of that without threading a prop through every row.
 *
 * ⚠️ ONE OBJECT RATHER THAN FOUR `let`s, and that is not tidiness: these are read
 * and written from four different modules now, and an ES module import is a
 * READ-ONLY BINDING — `drag.taskId = id` from another file does not compile.
 * Mutating a property of an imported const object is legal and is the whole
 * point of the indirection.
 */
export const drag: {
  taskId: string | null;
  sectionId: string | null;
  boardId: string | null;
  groupId: string | null;
} = { taskId: null, sectionId: null, boardId: null, groupId: null };


/** Distinct from TASK_DRAG_TYPE so the two drag systems in this table never
 *  mistake one another's payloads. */
export const SECTION_DRAG_TYPE = "application/x-studio-section-id";


/** Distinct from the task and section types, for the same reason those two are. */
export const GROUP_DRAG_TYPE = "application/x-studio-group-id";


/** The two tabs that list tasks — the only ones the Show settings apply to. */
export type TaskTab = "tasks" | "board" | "timeline";
