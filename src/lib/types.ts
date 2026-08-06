export type Role = "admin" | "designer";

export interface Profile {
  id: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  /** studio cut-out portrait (head-to-arms, white studio&more tee) */
  photoUrl: string | null;
  active: boolean;
  /**
   * false = a person kept only for historical attribution (pre-Everhour staff,
   * migration 0018). No auth.users row exists, so they can never sign in — hide
   * every account action (invite, password link, email) for them.
   */
  hasAccount?: boolean;
  startDate: string | null;
  /**
   * Last day in the studio (migration 0020). Non-null forces `active` false — the
   * database enforces it, so never set one without expecting the other. Null means
   * either still here or simply not recorded yet; read `active` for that.
   */
  endDate: string | null;
  capacityHoursWeek: number | null;
}

/**
 * A kind of work — Design, QA, Wireframe (migration 0024). Separate from `Tag`
 * (shown as "Status" in the UI),
 * which records where a task is in the process: the two answer different
 * questions and a task legitimately has both. The Timeline paints its bars with
 * this colour.
 */
export interface TaskType {
  id: string;
  name: string;
  color: string;
  position: number;
}

/**
 * ⚠️ **Called "Status" everywhere in the UI** (renamed 2026-08-06) — it records
 * where a task is in the process: "in design", "Client approval", "Approved".
 * The table, the column and every identifier are still `tag`/`tags`/`tag_id`,
 * because renaming the schema and ~40 references is a large, risky diff for a
 * label change. If you touch this: UI copy says Status, code says tag.
 *
 * Not to be confused with `Task.status` (todo | in_progress | done), which the
 * UI never calls "status" — it surfaces as the completion tick and the board's
 * To do / In progress / Done columns.
 *
 * Also not `TaskType`, which is the KIND of work rather than its stage.
 */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Client {
  id: string;
  name: string;
  color: string;
  billingPeriodNote: string;
  archived: boolean;
  /** false = internal client (Studio…): its tasks are never billable */
  billable: boolean;
  /** free-text invoice day of month shown on Reports ("15th", "1st"…) */
  invoiceNote: string;
  /**
   * A preset glyph name from CLIENT_ICONS (migration 0023), or null for the
   * client's initial. Ignored when `iconUrl` is set.
   */
  icon: string | null;
  /** uploaded client mark (migration 0023). Wins over `icon` when both exist. */
  iconUrl: string | null;
  /**
   * The client-level equivalent of a task brief (migration 0022): standing
   * context anyone in the studio may need — tone of voice, who signs off,
   * where the assets live. Readable by everyone, admin-writable.
   */
  notes: string;
}

/**
 * A titled reference link (migration 0022) belonging to EITHER a task or a
 * client — exactly one of the two ids is set, which the DB enforces. Only the
 * title is rendered; the URL hides behind it, because these are Google Docs and
 * Dropbox URLs that are 200 characters of nothing anyone can read.
 */
export interface Link {
  id: string;
  taskId: string | null;
  clientId: string | null;
  title: string;
  url: string;
  position: number;
}

export interface Section {
  id: string;
  clientId: string;
  name: string;
  position: number;
  /** budget parsed from the old section name; falls back to the sum of its tasks */
  estimateHours?: number | null;
  /** pre-Everhour hours parsed from the old section name (display-only) */
  legacyHours?: number | null;
  /** original name before the hour figures were parsed out of it */
  legacyName?: string | null;
  /** closing date that trailed the old section name, e.g. "(27/1/2021)" */
  closedOn?: string | null;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  clientId: string;
  sectionId: string | null;
  title: string;
  brief: string;
  figmaUrl: string | null;
  status: TaskStatus;
  tag: string | null;
  /** kind of work (0024) — held by ID, unlike `tag`, which is denormalised to its name */
  typeId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  /**
   * Left edge of the task's bar on the client Timeline (migration 0022). Null
   * means "no duration known" — the timeline draws a single-day bar on the due
   * date, and dragging its left edge is what fills this in. Admin-only in the
   * DB, like `dueDate` (0022 amends the 0011 trigger to say so).
   */
  startDate: string | null;
  billable: boolean;
  estimateHours: number | null;
  position: number;
  /**
   * Row order on the client Timeline (migration 0023) — deliberately NOT
   * `position`, which is per-section and drives the Tasks tab. Null means
   * "never dragged"; those rows sort after the placed ones, by start date.
   */
  timelinePosition: number | null;
  /** true while a client intake request is approved-pending confirmation */
  pending?: boolean;
  /**
   * Pre-Everhour hours we know were worked but could not pin to a person and a
   * date — the remainder after this task's `legacy` time entries. Display-only:
   * never aggregate it by month or by user, it has neither.
   */
  legacyHours?: number | null;
  /** original title before the hour figures were parsed out of it */
  legacyTitle?: string | null;
  /** first/last Asana comment date, when the hours came from the comment thread */
  activityFrom?: string | null;
  activityTo?: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  /** null for imported Asana comments whose author predates the studio's profiles */
  userId: string | null;
  body: string;
  createdAt: string;
  /** raw Asana author name, kept when no profile matched */
  authorName?: string | null;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  uploadedBy: string | null;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  /** null only on recovered pre-Everhour entries whose author has no profile (0017) */
  userId: string | null;
  /** raw Asana author name, when userId is null */
  legacyAuthorName?: string | null;
  date: string;
  minutes: number;
  description: string;
  movedFromTaskId: string | null;
  /**
   * Reconstructed from a pre-Everhour Asana comment rather than logged by the
   * person in this app. Counts toward client and task totals; must be EXCLUDED
   * from personal stats, the days-worked counter and the feed timesheet — a
   * 2021 backfill must not invent working days for someone today.
   */
  legacy?: boolean;
  /**
   * The HOURS are real (recorded on the task itself) but the DATE was inferred
   * from the task comment activity window — migration 0019. Always also legacy.
   */
  dateEstimated?: boolean;
}

export type PlanEntryType = "task" | "free_text" | "absence";
export type AbsenceType = "vacation" | "sick" | "day_off";

/** Slim time-entry row kept in memory for all history (no description). */
export interface EntrySum {
  id: string;
  taskId: string;
  /** null only on recovered pre-Everhour entries whose author has no profile (0017) */
  userId: string | null;
  date: string;
  minutes: number;
  /** see TimeEntry.legacy — include in client/task totals, exclude from personal stats */
  legacy?: boolean;
  /** see TimeEntry.dateEstimated — real hours, inferred date */
  dateEstimated?: boolean;
}

/**
 * An entry logged by a real person in this app — i.e. any non-`legacy` row.
 * Narrowing to this is what makes `userId` non-null, so every personal or
 * per-member aggregation can index by it without a guard. The store's
 * `entrySums` is this type; `entrySumsAll` keeps the nullable form.
 */
export interface UserEntrySum extends Omit<EntrySum, "userId"> {
  userId: string;
}

export interface ReportLink {
  id: string;
  clientId: string;
  token: string;
  preset: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  active: boolean;
  createdAt: string;
  /** frozen report data shown to the client; null = never published */
  snapshot: ReportSnapshot | null;
  publishedAt: string | null;
  hiddenColumns: string[];
  hiddenTaskIds: string[];
  /** admin-edited column date ranges; null = auto week buckets */
  customWeeks: { label: string; from: string; to: string }[] | null;
}

/** Frozen, admin-approved report payload rendered by /report/[token]. */
export interface ReportSnapshot {
  clientName: string;
  clientColor: string;
  generatedAt: string;
  periods: { label: string; from: string; to: string; hourCap: number | null; advanceHours: number | null }[];
  /** week columns like the studio's Excel ("16 Dec - 27 Dec"); only weeks with hours */
  weeks?: { label: string; from: string; to: string }[];
  sections: {
    name: string;
    tasks: {
      id: string;
      title: string;
      estimateHours: number | null;
      totalMinutes: number;
      /** minutes per period, indexed like `periods` */
      periodMinutes: number[];
      /** minutes per week column, indexed like `weeks` */
      weekMinutes?: number[];
    }[];
  }[];
  invoices?: { label: string; note: string }[];
}

export interface BillingPeriod {
  id: string;
  clientId: string;
  label: string;
  dateFrom: string;
  dateTo: string;
  hourCap: number | null;
  advanceHours: number | null;
  position: number;
  /** invoiced & paid — rendered strikethrough on Reports */
  paid: boolean;
}

/** Whole-row day state on the weekly plan (holiday or custom label). */
export interface DayState {
  id: string;
  dateFrom: string;
  dateTo: string;
  label: string;
}

export type DevStatus = "pricing" | "in_approval" | "wip" | "qa" | "client_qa" | "done";

export interface DevItem {
  id: string;
  text: string;
  status: DevStatus;
  position: number;
}

export interface PlanColumn {
  id: string;
  name: string;
  profileId: string | null;
  position: number;
  type: "member" | "waiting_list" | "studio";
  hidden: boolean;
}

export interface PlanEntry {
  id: string;
  date: string | null; // yyyy-mm-dd; null = waiting list
  columnId: string;
  position: number;
  type: PlanEntryType;
  taskId: string | null;
  text: string;
  clientId: string | null;
  absenceType: AbsenceType | null;
}
