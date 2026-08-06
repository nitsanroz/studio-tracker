/* eslint-disable @typescript-eslint/no-explicit-any --
   Row → app-type mappers below sit at the Supabase boundary: their INPUT is an
   untyped DB row (no generated types), but every mapper has an explicit RETURN
   type, so the type safety consumers rely on is intact. Typing each row would
   add casts on every field for no real safety gain. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillingPeriod,
  Client,
  DayState,
  DevItem,
  EntrySum,
  Link,
  PlanColumn,
  PlanEntry,
  Profile,
  ReportLink,
  Section,
  Tag,
  Task,
  TaskComment,
  TaskType,
  TimeEntry,
} from "./types";

/** An untyped row as it comes back from Supabase (no generated types). */
export type DbRow = Record<string, unknown>;

/**
 * A failed query, with the Postgres error code preserved.
 *
 * The boot path asks for columns that only exist after certain migrations and
 * falls back to a smaller column set when they're absent. That fallback has to
 * be able to tell "this column doesn't exist yet" from "the network dropped" —
 * otherwise a transient failure silently degrades the app to a column set with
 * no `legacy` flag, and ~4,000h of backfill starts reading as ordinary logged
 * time. Throwing a bare Error threw that distinction away.
 */
export class DbError extends Error {
  readonly code?: string;
  constructor(table: string, message: string, code?: string) {
    super(`${table}: ${message}`);
    this.name = "DbError";
    this.code = code;
  }
}

/** 42703 undefined_column · 42P01 undefined_table — i.e. a migration isn't applied. */
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01"]);

/** True when the query failed because the schema lacks something, not because the request failed. */
export function isMissingSchema(e: unknown): boolean {
  return e instanceof DbError && !!e.code && MISSING_SCHEMA_CODES.has(e.code);
}

/** Supabase caps selects at 1000 rows — page through everything. */
export async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  modify?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (modify) q = modify(q);
    const { data, error } = await q;
    if (error) throw new DbError(table, error.message, error.code);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ── row → app-type mappers ────────────────────────────────────────────────

export const mapProfile = (r: any): Profile => ({
  id: r.id,
  name: r.name,
  role: r.role,
  avatarUrl: r.avatar_url,
  photoUrl: r.photo_url ?? null,
  active: r.active,
  hasAccount: r.has_account ?? true, // column exists from migration 0018
  startDate: r.start_date ?? null,
  endDate: r.end_date ?? null,
  capacityHoursWeek: r.capacity_hours_week == null ? null : Number(r.capacity_hours_week),
});

export const mapTaskType = (r: any): TaskType => ({
  id: r.id,
  name: r.name,
  color: r.color ?? "#6b7280",
  position: r.position ?? 0,
});

export const mapTag = (r: any): Tag => ({
  id: r.id,
  name: r.name,
  color: r.color ?? "#6b7280",
});

export const mapEntrySum = (r: any): EntrySum => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  date: r.date,
  minutes: r.minutes ?? 0,
  legacy: r.legacy ?? false, // column exists from migration 0016
  dateEstimated: r.date_estimated ?? false, // column exists from migration 0019
});

export const mapReportLink = (r: any): ReportLink => ({
  id: r.id,
  clientId: r.client_id,
  token: r.token,
  preset: r.preset,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  active: r.active,
  createdAt: r.created_at,
  snapshot: r.snapshot ?? null,
  publishedAt: r.published_at ?? null,
  hiddenColumns: r.hidden_columns ?? [],
  hiddenTaskIds: r.hidden_task_ids ?? [],
  customWeeks: r.custom_weeks ?? null,
});

export const mapBillingPeriod = (r: any): BillingPeriod => ({
  id: r.id,
  clientId: r.client_id,
  label: r.label,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  hourCap: r.hour_cap == null ? null : Number(r.hour_cap),
  advanceHours: r.advance_hours == null ? null : Number(r.advance_hours),
  position: r.position,
  paid: r.paid ?? false, // column exists from migration 0010
});

export const mapDayState = (r: any): DayState => ({
  id: r.id,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  label: r.label,
});

export const mapDevItem = (r: any): DevItem => ({
  id: r.id,
  text: r.text,
  status: r.status,
  position: r.position,
});

export const mapClient = (r: any): Client => ({
  id: r.id,
  name: r.name,
  color: r.color,
  billingPeriodNote: r.billing_period_note ?? "",
  archived: r.archived,
  billable: r.billable ?? true, // column exists from migration 0009
  invoiceNote: r.invoice_note ?? "", // column exists from migration 0010
  notes: r.notes ?? "", // column exists from migration 0022
  icon: r.icon ?? null, // columns exist from migration 0023
  iconUrl: r.icon_url ?? null,
});

export const mapLink = (r: any): Link => ({
  id: r.id,
  taskId: r.task_id ?? null,
  clientId: r.client_id ?? null,
  title: r.title,
  url: r.url,
  position: r.position ?? 0,
});

// Pre-0007 rows have client_id null; fall back via projectClientById (legacy).
export const mapSection = (r: any, projectClientById?: Map<string, string>): Section => ({
  id: r.id,
  clientId: r.client_id ?? projectClientById?.get(r.project_id) ?? "",
  name: r.name,
  position: r.position,
  // columns exist from migration 0016
  estimateHours: r.estimate_hours == null ? null : Number(r.estimate_hours),
  legacyHours: r.legacy_hours == null ? null : Number(r.legacy_hours),
  legacyName: r.legacy_name ?? null,
  closedOn: r.closed_on ?? null,
});

export const mapTask = (
  r: any,
  tagNameById: Map<string, string>,
  projectClientById?: Map<string, string>,
): Task => ({
  id: r.id,
  clientId: r.client_id ?? projectClientById?.get(r.project_id) ?? "",
  sectionId: r.section_id,
  title: r.title,
  brief: r.brief ?? "",
  figmaUrl: r.figma_url,
  status: r.status,
  tag: r.tag_id ? (tagNameById.get(r.tag_id) ?? null) : null,
  typeId: r.type_id ?? null, // migration 0024
  assigneeId: r.assignee_id,
  dueDate: r.due_date,
  startDate: r.start_date ?? null, // column exists from migration 0022
  timelinePosition: r.timeline_position ?? null, // migration 0023
  billable: r.billable,
  estimateHours: r.estimate_hours == null ? null : Number(r.estimate_hours),
  position: r.position,
  pending: r.pending,
  // columns exist from migration 0016
  legacyHours: r.legacy_hours == null ? null : Number(r.legacy_hours),
  legacyTitle: r.legacy_title ?? null,
  activityFrom: r.activity_from ?? null,
  activityTo: r.activity_to ?? null,
});

export const mapTimeEntry = (r: any): TimeEntry => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  date: r.date,
  minutes: r.minutes ?? 0,
  description: r.description ?? "",
  movedFromTaskId: r.moved_from_task_id,
  legacy: r.legacy ?? false, // column exists from migration 0016
  legacyAuthorName: r.legacy_author_name ?? null, // column exists from migration 0017
  dateEstimated: r.date_estimated ?? false, // column exists from migration 0019
});

export const mapComment = (r: any): TaskComment => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  body: r.body,
  createdAt: r.created_at,
  authorName: r.author_name ?? null, // column exists from migration 0016
});

export const mapPlanColumn = (r: any): PlanColumn => ({
  id: r.id,
  name: r.name,
  profileId: r.profile_id,
  position: r.position,
  type: r.type,
  hidden: r.hidden ?? false,
});

export const mapPlanEntry = (r: any): PlanEntry => ({
  id: r.id,
  date: r.date,
  columnId: r.column_id,
  position: r.position,
  type: r.type,
  taskId: r.task_id,
  text: r.text ?? "",
  clientId: r.client_id,
  absenceType: r.absence_type,
});

/** App-side Task patch → DB column patch. */
export function taskPatchToRow(
  patch: Partial<Task>,
  tagIdByName: Map<string, string>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("title" in patch) row.title = patch.title;
  if ("brief" in patch) row.brief = patch.brief;
  if ("figmaUrl" in patch) row.figma_url = patch.figmaUrl;
  if ("status" in patch) {
    row.status = patch.status;
    row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  if ("tag" in patch) row.tag_id = patch.tag ? (tagIdByName.get(patch.tag) ?? null) : null;
  if ("typeId" in patch) row.type_id = patch.typeId;
  // Without this a "move to another client" updated local state, wrote an EMPTY
  // patch object, and silently reverted on the next reload.
  if ("clientId" in patch) row.client_id = patch.clientId;
  if ("assigneeId" in patch) row.assignee_id = patch.assigneeId;
  if ("dueDate" in patch) row.due_date = patch.dueDate;
  if ("startDate" in patch) row.start_date = patch.startDate;
  if ("timelinePosition" in patch) row.timeline_position = patch.timelinePosition;
  if ("billable" in patch) row.billable = patch.billable;
  if ("estimateHours" in patch) row.estimate_hours = patch.estimateHours;
  if ("sectionId" in patch) row.section_id = patch.sectionId;
  if ("position" in patch) row.position = patch.position;
  if ("pending" in patch) row.pending = patch.pending;
  return row;
}
