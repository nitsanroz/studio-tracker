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
  capacityHoursWeek: number | null;
}

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
  assigneeId: string | null;
  dueDate: string | null;
  billable: boolean;
  estimateHours: number | null;
  position: number;
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
