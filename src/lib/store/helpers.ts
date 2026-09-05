// Pure helpers used across the store's domains.
//
// No React and no Supabase, so they are unit-testable on their own — which is
// why `withGroupInvariant` already has a suite (`group-invariant.test.ts`)
// while nothing else in the old single-file store did.

import type { Task, TaskGroup } from "../types";
import type { TaskRequest } from "./types";

export function inversePatch<T extends object>(before: T, patch: Partial<T>): Partial<T> {
  const prev: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) prev[k] = before[k];
  return prev;
}

/**
 * Keeps `groupId` and `sectionId` in agreement — the one thing migration 0027
 * cannot express as a constraint. A composite FK would need
 * `task_groups(section_id, id)` to be unique, which forbids the null-section
 * case outright, so the rule lives here instead and every reader stays
 * defensive about it.
 *
 * Filing a task INTO a group implies its section; moving a task to another
 * SECTION takes it out of a group that lives elsewhere.
 *
 * ⚠️ Applied to the PATCH, before it is recorded — so `inversePatch` sees both
 * keys and a single ⌘Z puts both back. Normalising after the fact would leave an
 * undo step that restores the section and strands the group.
 */
export function withGroupInvariant(
  before: Task,
  patch: Partial<Task>,
  groups: TaskGroup[],
): Partial<Task> {
  if ("groupId" in patch) {
    const g = patch.groupId ? groups.find((x) => x.id === patch.groupId) : null;
    // The group is the more specific statement, so it decides the section — a
    // `sectionId` already in the patch is overruled rather than trusted, since
    // the two cannot both be right. An unknown id is left alone: the read paths
    // treat it as ungrouped, which is the safe degradation.
    //
    // ⚠️ COMPARED AGAINST THE SECTION THE PATCH IS ASKING FOR, not just the one
    // the task is leaving. Reading only `before.sectionId` meant a patch naming a
    // group AND a conflicting section passed through untouched whenever the
    // group already sat in the task's current section — storing the task in a
    // group that lives somewhere else, which is the exact state this function
    // exists to make impossible. No caller does that today; every reader
    // tolerates it by rendering the task loose, so a future one would break the
    // invariant silently and the symptom would be a task quietly falling out of
    // its group.
    const wanted = "sectionId" in patch ? (patch.sectionId ?? null) : before.sectionId;
    if (g && g.sectionId !== wanted) return { ...patch, sectionId: g.sectionId };
    return patch;
  }
  if ("sectionId" in patch && before.groupId) {
    const g = groups.find((x) => x.id === before.groupId);
    if (!g || g.sectionId !== patch.sectionId) return { ...patch, groupId: null };
  }
  return patch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB-boundary row mapper (return type is explicit)
export const mapTaskRequest = (r: any): TaskRequest => ({
  id: r.id,
  clientId: r.client_id,
  suggestedClientId: r.suggested_client_id ?? null,
  submitterName: r.submitter_name,
  submitterEmail: r.submitter_email,
  title: r.title,
  brief: r.brief ?? "",
  requestedDueDate: r.requested_due_date,
  budgetHours: r.client_approved_budget_hours == null ? null : Number(r.client_approved_budget_hours),
  status: r.status,
  createdTaskId: r.created_task_id,
  createdAt: r.created_at,
  answers: r.answers ?? null,
  // ?? null, not r.seen_at: before 0028 the columns don't exist and the row
  // simply lacks the keys. The queue then reads as "nothing acknowledged yet",
  // which is exactly right.
  seenAt: r.seen_at ?? null,
  seenBy: r.seen_by ?? null,
  clientNotifiedAt: r.client_notified_at ?? null,
  // Same `?? null` reasoning as above, for 0029: an unapplied migration leaves
  // the key absent, which reads as "never edited".
  editedAt: r.edited_at ?? null,
  answersAck: r.answers_ack ?? null,
  ackedAt: r.acked_at ?? null,
});
