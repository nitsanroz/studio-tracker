// Shared shapes for the data store.
//
// Split out of the old single-file `store.tsx` (4,134 lines, of which the
// provider alone was ~3,500) so a change to one domain no longer means reading
// past every other. TYPES ONLY — no hooks, no React, so anything may import it
// without dragging the provider in. (`PLAN_ENTRY_FIELDS` is the one value here:
// it is the column mapping that defines `PlanEntryPatch`, and separating the two
// is how they drift.)

import type {
  AbsenceType,
  Attachment,
  BillingPeriod,
  Client,
  DayState,
  DevItem,
  DevStatus,
  EntrySum,
  UserEntrySum,
  Link,
  PlanColumn,
  PlanEntry,
  PlanEntryType,
  Profile,
  Section,
  Tag,
  Task,
  TaskComment,
  TaskGroup,
  TaskType,
  TimeEntry,
  TimelineMark,
} from "../types";

export interface TaskRequest {
  id: string;
  clientId: string | null;
  suggestedClientId: string | null;
  submitterName: string;
  submitterEmail: string;
  title: string;
  brief: string;
  requestedDueDate: string | null;
  budgetHours: number | null;
  status: "pending" | "approved" | "rejected";
  createdTaskId: string | null;
  createdAt: string;
  answers: Record<string, unknown> | null;
  /**
   * When an admin acknowledged it, and when the client was told (0028).
   *
   * ⚠️ Two stamps, not one. If Resend is down the request must still register
   * as seen — otherwise a failed email leaves it looking untouched and the next
   * admin acknowledges it all over again. `clientNotifiedAt` is the one that
   * guarantees the client is never mailed twice.
   */
  seenAt: string | null;
  seenBy: string | null;
  clientNotifiedAt: string | null;
  /**
   * When the CLIENT last changed this brief after sending it (0029).
   *
   * ⚠️ The queue must surface it: an admin who has already read a brief — or
   * already pressed "we've seen it" — would otherwise be working from text the
   * client has since rewritten.
   */
  editedAt: string | null;
  /**
   * The client's answers as the studio last acknowledged them, and when (0030).
   *
   * ⚠️ This is the BASELINE a revision is diffed against — not the task's text,
   * which is the studio's own words and not a version of the client's answers at
   * all. Written when a brief is marked seen or approved; never written by a
   * client edit, or the comparison it exists for would be erased.
   */
  answersAck: Record<string, unknown> | null;
  ackedAt: string | null;
}

export interface ApproveRequestInput {
  clientId: string;
  sectionId: string | null;
  assigneeId: string | null;
  title: string;
  estimateHours: number | null;
  dueDate: string | null;
}

export interface NewPlanEntry {
  date: string | null;
  columnId: string;
  type: PlanEntryType;
  taskId?: string | null;
  text?: string;
  clientId?: string | null;
  absenceType?: AbsenceType | null;
}

/** What a plan entry may be changed INTO — see `updatePlanEntry`. */
export interface PlanEntryPatch {
  type?: PlanEntryType;
  taskId?: string | null;
  text?: string;
  clientId?: string | null;
  absenceType?: AbsenceType | null;
}

/** The one place a `PlanEntryPatch` field is paired with its column name. */
export const PLAN_ENTRY_FIELDS: { key: keyof PlanEntryPatch; col: string }[] = [
  { key: "type", col: "type" },
  { key: "taskId", col: "task_id" },
  { key: "text", col: "text" },
  { key: "clientId", col: "client_id" },
  { key: "absenceType", col: "absence_type" },
];

export interface TimeEntryPatch {
  minutes?: number;
  description?: string;
  date?: string;
  /** admin-only: move the entry to another member */
  userId?: string;
}

export interface Store {
  loading: boolean;
  profiles: Profile[];
  clients: Client[];
  sections: Section[];
  /** subject-level containers inside a section (0027); [] before the migration */
  taskGroups: TaskGroup[];
  tags: Tag[];
  tasks: Task[];
  comments: TaskComment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  /**
   * Slim rows for time entries (no description) — for aggregations.
   * EXCLUDES pre-Everhour backfill: use this for anything personal or
   * time-series (my hours, days worked, the feed timesheet, per-member totals).
   */
  entrySums: UserEntrySum[];
  /**
   * Every entry including the recovered pre-Everhour history. Use for
   * CLIENT-FACING and per-task totals — client stats, reports, task hours —
   * where the 2020–2022 work is real and belongs in the number.
   */
  entrySumsAll: EntrySum[];
  currentUserId: string;
  /** Name of the member an admin is previewing as (?viewAs=…), null when off. */
  viewingAs: string | null;
  openTaskId: string | null;
  planColumns: PlanColumn[];
  planEntries: PlanEntry[];
  billingPeriods: BillingPeriod[];
  dayStates: DayState[];
  links: Link[];
  /** kinds of work with their colours (0024); the Timeline paints bars with these */
  taskTypes: TaskType[];
  /** true once this task's lazily-loaded brief has arrived and is safe to edit */
  briefLoaded: (taskId: string) => boolean;
  devItems: DevItem[];

  openTask: (taskId: string | null) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  /**
   * Apply one patch to many tasks in a single write, as ONE undo step.
   * Moving between clients must also set `sectionId` (a section belongs to
   * exactly one client, so the old id would strand the tasks).
   */
  updateTasksBulk: (taskIds: string[], patch: Partial<Task>) => void;
  /** Per-task patches as ONE undo step — see the implementation's note. */
  updateTasksVaried: (items: { id: string; patch: Partial<Task> }[]) => void;
  timelineMarks: TimelineMark[];
  addTimelineMark: (clientId: string, onDate: string, title: string) => void;
  updateTimelineMark: (id: string, patch: { title?: string; onDate?: string }) => void;
  deleteTimelineMark: (id: string) => void;
  /** Undo counterpart of updateTasksBulk: restores each task's own prior values. */
  restoreTasksBulk: (items: { id: string; patch: Partial<Task> }[]) => void;
  /** `groupId` overrules `sectionId` when given — the group decides the section. */
  addTask: (
    clientId: string,
    sectionId: string | null,
    title: string,
    groupId?: string | null,
  ) => void;
  addTaskNear: (
    anchorTaskId: string,
    where: "before" | "after",
    title: string,
    opts?: { copyDates?: boolean },
  ) => void;
  /** Hard-delete a task. CASCADES to its time entries — confirm with the user first. */
  deleteTask: (taskId: string) => void;
  /** Hard-delete many tasks. CASCADES to time entries — confirm with the user first. */
  deleteTasksBulk: (taskIds: string[]) => void;
  addSection: (clientId: string, name: string) => void;
  updateSection: (sectionId: string, patch: Partial<Pick<Section, "name">>) => void;
  /** No-ops (with a visible write error) if the section still contains tasks or groups. */
  deleteSection: (sectionId: string) => void;
  /**
   * Move `movedId` before `beforeId` within its own CONTAINER — the same section
   * AND the same group; null = to the end.
   */
  reorderTask: (movedId: string, beforeId: string | null) => void;
  /** Move a section before another within its own client; null = to the end. */
  reorderSection: (movedId: string, beforeId: string | null) => void;
  /** Resolves with the created group so a caller can file tasks into it. */
  addTaskGroup: (
    clientId: string,
    sectionId: string | null,
    name: string,
  ) => Promise<TaskGroup | null>;
  updateTaskGroup: (groupId: string, patch: Partial<Pick<TaskGroup, "name">>) => void;
  /**
   * Create a group from an existing selection and file all of it in — the
   * "gather these into a group" gesture.
   *
   * Resolves to null on success, or to a sentence explaining why not: every task
   * has to already share ONE client and ONE section, because a group belongs to a
   * single section and moving the tasks to make that true would be a second,
   * unasked-for change.
   */
  groupTasksIntoNew: (taskIds: string[], name: string) => Promise<string | null>;
  /**
   * Remove a group. `withTasks` false (the default) DISSOLVES it — the tasks move
   * up to the section — and true deletes them with it.
   *
   * ⚠️ `withTasks` CASCADES to time entries and is not undoable. The caller must
   * confirm, and must refuse when any task carries logged hours.
   */
  deleteTaskGroup: (groupId: string, opts?: { withTasks?: boolean }) => void;
  /** Move a group before another within its own section; null = to the end. */
  reorderTaskGroup: (movedId: string, beforeId: string | null) => void;
  addClient: (name: string, color: string, billingPeriodNote?: string) => Promise<Client | null>;
  patchProfileLocal: (profileId: string, patch: Partial<Profile>) => void;
  /** local-only; for values an API route already persisted with the service key */
  patchClientLocal: (clientId: string, patch: Partial<Client>) => void;
  updateProfile: (profileId: string, patch: Partial<Profile>) => void;
  updateClient: (clientId: string, patch: Partial<Client>) => void;
  addTaskType: (name: string, color: string) => void;
  updateTaskType: (typeId: string, patch: Partial<Pick<TaskType, "name" | "color">>) => void;
  deleteTaskType: (typeId: string) => void;
  addTag: (name: string, color: string) => void;
  updateTag: (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => void;
  deleteTag: (tagId: string) => void;
  addPlanEntry: (input: NewPlanEntry) => void;
  /**
   * Change what an existing plan entry IS — a free-text note becomes a real task,
   * an absence changes kind, a note's wording or client changes. One undo step,
   * restoring every field it touched.
   */
  updatePlanEntry: (entryId: string, patch: PlanEntryPatch) => void;
  movePlanEntry: (
    entryId: string,
    target: { date: string | null; columnId: string },
    place?: { beforeId: string | null },
  ) => void;
  /**
   * The weekly plan's drop target: move the entry, and when it lands in a
   * DIFFERENT person's column, reassign the underlying task to them — as one
   * undo step. Falls back to a plain move when there is nobody to reassign to.
   */
  movePlanEntryToCell: (
    entryId: string,
    target: { date: string | null; columnId: string },
    place?: { beforeId: string | null },
  ) => void;
  deletePlanEntry: (entryId: string) => void;
  addPlanColumn: (name: string) => void;
  updatePlanColumn: (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => void;
  movePlanColumn: (columnId: string, direction: -1 | 1) => void;
  deletePlanColumn: (columnId: string) => void;
  addComment: (taskId: string, body: string) => void;
  /** admin-only in the UI; undo restores the row with its original id and timestamp */
  deleteComment: (id: string) => void;
  /** Timeline row order (0023) — pass the FULL list of shown ids in their new order */
  reorderTimelineTasks: (orderedIds: string[]) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  /** Resolves to the inserted entry (or null) so a caller can edit it immediately. */
  addTimeEntry: (
    taskId: string,
    minutes: number,
    description: string,
    date?: string,
    userId?: string,
  ) => Promise<TimeEntry | null>;
  /** One member's entries for one date. `timeEntries` only holds the recent 400. */
  loadDayEntries: (userId: string, dateIso: string) => Promise<TimeEntry[]>;
  /** the log rows behind one hours cell of the client report — see `loadCellEntries` */
  loadCellEntries: (taskId: string, from: string, to: string) => Promise<TimeEntry[]>;
  /** move `minutes` of one entry onto the client's non-billable Keys task — see `writeDownToKeys` */
  writeDownToKeys: (entryId: string, minutes: number, keysTaskId: string) => Promise<boolean>;
  /** the same, for one designer's hours on a task rather than one entry — see `writeDownMemberToKeys` */
  writeDownMemberToKeys: (
    taskId: string,
    userId: string,
    minutes: number,
    keysTaskId: string,
    range?: { from: string; to: string },
  ) => Promise<boolean>;
  /**
   * `userId` reassigns the entry to another member — admins only. RLS refuses it
   * for members anyway: `own time update`'s USING clause constrains the very
   * column being changed, and Postgres reuses it as the check on the new row.
   */
  updateTimeEntry: (entryId: string, patch: TimeEntryPatch) => void;
  /** `known` lets a caller holding the full row keep undo working for an entry outside the feed window. */
  deleteTimeEntry: (entryId: string, known?: TimeEntry) => void;
  moveTimeEntries: (entryIds: string[], fromTaskId: string, toTaskId: string) => void;
  addBillingPeriod: (input: Omit<BillingPeriod, "id" | "position" | "paid">) => void;
  updateBillingPeriod: (id: string, patch: Partial<BillingPeriod>) => void;
  deleteBillingPeriod: (id: string) => void;
  addDayState: (dateFrom: string, dateTo: string, label: string) => void;
  deleteDayState: (id: string) => void;
  /** `owner` is exactly one of taskId / clientId — see the DB CHECK in 0022 */
  addLink: (owner: { taskId: string } | { clientId: string }, title: string, url: string) => void;
  updateLink: (id: string, patch: { title?: string; url?: string }) => void;
  deleteLink: (id: string) => void;
  addDevItem: (text: string) => void;
  updateDevItem: (id: string, patch: { text?: string; status?: DevStatus }) => void;
  deleteDevItem: (id: string) => void;
  taskRequests: TaskRequest[];
  /** Resolves to the new task's id, so the caller can open its pane. */
  approveRequest: (requestId: string, input: ApproveRequestInput) => Promise<string | null>;
  rejectRequest: (requestId: string) => void;
  deleteRequest: (requestId: string) => void;
  markRequestSeen: (requestId: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Briefs a client has changed since the studio last acknowledged them.
   *
   * ⚠️ Derived ONCE here rather than by each consumer. The shell's badge, the
   * home-page banner and the queue all ask the same question, and three copies of
   * `taskRequests.filter(needsReview)` is how a badge comes to disagree with the
   * list it points at — the same reason `task-rollup.ts` and `taskMinutesDone` were
   * extracted in earlier releases.
   */
  updatedRequests: TaskRequest[];
  /** "I've read the client's changes" — re-baselines the diff, nothing more. */
  markRevisionReviewed: (requestId: string) => void;
  taskMinutes: (taskId: string) => number;
  /** Undo/redo the last data actions (max 10). Also on cmd/ctrl+Z (+shift). */
  undo: () => void;
  redo: () => void;
  /** Set when a background write to Supabase fails; the UI surfaces a banner. */
  writeError: string | null;
  dismissWriteError: () => void;
  /**
   * Supabase is refusing every request because the organization is over its
   * egress quota (HTTP 402). Distinct from `writeError` — nothing the user did
   * failed, and reloading will not help — and distinct from an ordinary refresh
   * failure, which stays silent on purpose. See `isServiceBlocked`.
   */
  serviceBlocked: boolean;
  /**
   * A neutral, informational message — currently only "that undo expired".
   * Deliberately NOT writeError: that banner is about failed saves and says
   * "reload", neither of which applies here.
   */
  /**
   * The row created most recently, for ~600ms.
   *
   * ⚠️ A time entry lands in a DATE-SORTED list, not at the bottom, so this is
   * what answers "which one is mine, and where did it go?" — read by any list
   * that renders entries and turned into the 400ms `row-flash` (Nitsan's variant
   * 3A). It is state, not a callback through six hosts, precisely so every
   * surface that shows entries can flash without being wired individually.
   *
   * ⚠️ It CLEARS ITSELF after 600ms — longer than the animation, so the class is
   * definitely gone before a re-render could restart it, and short enough that a
   * refresh arriving later cannot re-flash a row from minutes ago.
   */
  freshEntryId: string | null;
  notice: string | null;
  /** Say something neutral to the user — a refusal or an explanation, not an error. */
  showNotice: (text: string) => void;
  dismissNotice: () => void;
  /** True while a background refresh is in flight (a quiet indicator, not a blocker). */
  refreshing: boolean;
  /**
   * Polling has stopped because nobody has touched this tab for IDLE_AFTER_MS.
   * Surfaced so the sync dot can stop implying the figures are live — the data
   * is as of `lastSyncedAt`, and any interaction resumes immediately.
   */
  pollingPaused: boolean;
  /** epoch ms of the last successful sync, for the indicator's tooltip. */
  lastSyncedAt: number | null;
  /** Force a refresh now (the interval and tab-focus do this automatically). */
  refresh: () => void;
  /**
   * Set when the initial load failed. Distinct from `writeError`: there is no
   * data at all, so the UI must not render an empty state that reads as "the
   * studio has nothing" — see AppShell.
   */
  bootError: string | null;
}

export interface HistoryAction {
  undo: () => void;
  redo: () => void;
  /**
   * Which refresh generation this step was recorded against. An undo whose epoch
   * has moved on would push a value captured BEFORE a colleague's change back to
   * the server — silently reverting their edit. See `undo`.
   */
  epoch: number;
}
