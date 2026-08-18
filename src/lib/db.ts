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
  TaskGroup,
  TaskType,
  TimeEntry,
  TimelineMark,
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
  /**
   * The HTTP status, when there was one. Carried because the Postgres error
   * `code` is undefined for failures that never reached Postgres — a 402 from
   * Supabase's own quota enforcement being the one that matters. See
   * `isServiceBlocked`.
   */
  readonly status?: number;
  constructor(table: string, message: string, code?: string, status?: number) {
    super(`${table}: ${message}`);
    this.name = "DbError";
    this.code = code;
    this.status = status;
  }
}

/**
 * A migration isn't applied: 42703 undefined_column · 42P01 undefined_table.
 *
 * ⚠️ PGRST204 is the same fact reported by a DIFFERENT LAYER, and leaving it out
 * cost a broken intake form: Postgres raises 42703 when a SELECT names an unknown
 * column, but on an INSERT or UPDATE **PostgREST** rejects the payload first with
 * `PGRST204 "Could not find the 'x' column of 't' in the schema cache"` — so a
 * write-side fallback keyed only on 42703 never fires, and every submission 500s
 * until the SQL is run. Any code that writes a column a pending migration adds
 * needs this one.
 *
 * ⚠️ It is also what PostgREST returns while its schema cache is STALE — for a
 * few minutes after a `create table`/`add column`, a column that really does
 * exist can report PGRST204 (see the v1.10.0 log entry). A caller treating this
 * as "missing" therefore drops that value for those few minutes rather than
 * failing. That is the right trade for an optional column and the wrong one for
 * anything load-bearing: don't use this to skip something that must be written.
 */
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01", "PGRST204"]);

/** True when the query failed because the schema lacks something, not because the request failed. */
export function isMissingSchema(e: unknown): boolean {
  return e instanceof DbError && !!e.code && MISSING_SCHEMA_CODES.has(e.code);
}

/**
 * Supabase has stopped serving the project because the organization is over its
 * usage quota — every request returns **402 Payment Required**.
 *
 * ⚠️ Deliberately NARROW. A background refresh failing is normally a dropped
 * connection: nothing the user can act on, which is why `refresh` swallows it
 * and keeps the data already on screen. This one is different in both respects —
 * it is persistent and it is actionable (billing) — and it is invisible without
 * help: an open tab goes on showing stale figures indefinitely, and the first
 * sign otherwise is a CLIENT finding a broken report link. So this, and only
 * this, is promoted to a banner. Do not widen it to "any failure".
 *
 * The 402 has no Postgres `code` — it never reaches Postgres — so the status is
 * the only reliable signal, with the message as a fallback for the paths that
 * lose it.
 */
export function isServiceBlocked(e: unknown): boolean {
  if (e instanceof DbError && e.status === 402) return true;
  return e instanceof Error && /payment required/i.test(e.message);
}

/**
 * Throw a `DbError` (carrying the status, so `isServiceBlocked` can see it) for
 * a query built directly rather than through `fetchAll`.
 */
export function assertOk(
  table: string,
  res: { error: { message: string; code?: string } | null; status?: number },
): void {
  if (res.error) throw new DbError(table, res.error.message, res.error.code, res.status);
}

/**
 * An UPDATE whose optional columns may not exist yet — the write-side twin of
 * the `fetchAll` + `isMissingSchema` ladder above.
 *
 * ⚠️ THIS EXISTS BECAUSE THE PATTERN WAS HAND-ROLLED FOUR TIMES IN TWO RELEASES
 * and one of the four forgot the guard entirely. Every time a migration adds a
 * column that something writes, the write has to survive the window before that
 * SQL is run — and a missing column on a WRITE reports **PGRST204** from
 * PostgREST, not the `42703` Postgres raises on a SELECT, so a fallback copied
 * from the read path silently never fires. That is precisely how every intake
 * submission came to 500 in v1.19.4.
 *
 * `required` is written whatever happens; `optional` is dropped and the write
 * retried if — and only if — the schema is what refused it. Any other error is a
 * real error and is returned untouched.
 *
 * ⚠️ Do NOT use this for a column that must be written. Silently dropping a
 * value is right for a snapshot or a nice-to-have stamp and wrong for anything
 * the app then relies on; PGRST204 is also what PostgREST returns for a few
 * minutes while its schema cache is stale after a DDL change.
 */
export async function updateWithOptional(
  sb: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
  required: Record<string, unknown>,
  optional: Record<string, unknown>,
): Promise<{ error: { message: string; code?: string } | null; degraded: boolean }> {
  const first = await sb
    .from(table)
    .update({ ...required, ...optional })
    .match(match);
  if (!first.error) return { error: null, degraded: false };
  if (!isMissingSchema(new DbError(table, first.error.message, first.error.code))) {
    return { error: first.error, degraded: false };
  }
  // Nothing else to write — the whole point of the call was the optional part.
  if (!Object.keys(required).length) return { error: null, degraded: true };
  const retry = await sb.from(table).update(required).match(match);
  return { error: retry.error ?? null, degraded: true };
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
    const { data, error, status } = await q;
    if (error) throw new DbError(table, error.message, error.code, status);
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

export const mapTimelineMark = (r: any): TimelineMark => ({
  id: r.id,
  clientId: r.client_id,
  onDate: r.on_date,
  title: r.title ?? "",
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

/** migration 0027. No legacy shape to fall back on — the table is new. */
export const mapTaskGroup = (r: any): TaskGroup => ({
  id: r.id,
  clientId: r.client_id,
  sectionId: r.section_id ?? null,
  name: r.name,
  position: r.position ?? 0,
});

export const mapTask = (
  r: any,
  tagNameById: Map<string, string>,
  projectClientById?: Map<string, string>,
): Task => ({
  id: r.id,
  clientId: r.client_id ?? projectClientById?.get(r.project_id) ?? "",
  sectionId: r.section_id,
  groupId: r.group_id ?? null, // migration 0027
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
  if ("groupId" in patch) row.group_id = patch.groupId; // migration 0027
  if ("position" in patch) row.position = patch.position;
  if ("pending" in patch) row.pending = patch.pending;
  return row;
}
