import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Client,
  PlanColumn,
  PlanEntry,
  Profile,
  Project,
  Section,
  Task,
  TaskComment,
  TimeEntry,
} from "./types";

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
    if (error) throw new Error(`${table}: ${error.message}`);
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
  active: r.active,
});

export const mapClient = (r: any): Client => ({
  id: r.id,
  name: r.name,
  color: r.color,
  billingPeriodNote: r.billing_period_note ?? "",
  archived: r.archived,
});

export const mapProject = (r: any): Project => ({
  id: r.id,
  clientId: r.client_id,
  name: r.name,
  billable: r.billable,
  archived: r.archived,
});

export const mapSection = (r: any): Section => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  position: r.position,
});

export const mapTask = (r: any, tagNameById: Map<string, string>): Task => ({
  id: r.id,
  projectId: r.project_id,
  sectionId: r.section_id,
  title: r.title,
  brief: r.brief ?? "",
  figmaUrl: r.figma_url,
  status: r.status,
  tag: r.tag_id ? (tagNameById.get(r.tag_id) ?? null) : null,
  assigneeId: r.assignee_id,
  dueDate: r.due_date,
  billable: r.billable,
  estimateHours: r.estimate_hours == null ? null : Number(r.estimate_hours),
  position: r.position,
  pending: r.pending,
});

export const mapTimeEntry = (r: any): TimeEntry => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  date: r.date,
  minutes: r.minutes ?? 0,
  description: r.description ?? "",
  movedFromTaskId: r.moved_from_task_id,
});

export const mapComment = (r: any): TaskComment => ({
  id: r.id,
  taskId: r.task_id,
  userId: r.user_id,
  body: r.body,
  createdAt: r.created_at,
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
  if ("assigneeId" in patch) row.assignee_id = patch.assigneeId;
  if ("dueDate" in patch) row.due_date = patch.dueDate;
  if ("billable" in patch) row.billable = patch.billable;
  if ("estimateHours" in patch) row.estimate_hours = patch.estimateHours;
  if ("sectionId" in patch) row.section_id = patch.sectionId;
  if ("position" in patch) row.position = patch.position;
  if ("pending" in patch) row.pending = patch.pending;
  return row;
}
