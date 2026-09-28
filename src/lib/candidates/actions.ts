"use client";

// Every write this section makes.
//
// ⚠️ THERE IS NO UNDO HERE, AND THAT IS A DECISION RATHER THAN AN OMISSION.
// The global store's undo stack works because it holds the whole studio in
// memory and can put a previous value back; this section deliberately keeps no
// such copy (see ./types.ts). So the destructive actions are shaped to not need
// one: archiving is reversible by un-archiving, a stage move is reversible by
// moving back, and the only true delete — removing a candidate — is behind a
// confirm that names what goes with them.
//
// ⚠️ EVERY WRITE TOUCHES `last_activity_at`. It is the list view's default sort
// and the "Last activity" column, and a stored column that some writes update
// and others forget is worse than no column at all: the list quietly stops
// being in the order it claims.

import { createClient } from "../supabase/client";
import type { CandidateLinkKind, CandidateOutcome, CandidateStatus } from "./types";

/** Anything that failed loudly enough to tell the user about. */
export class CandidateWriteError extends Error {
  constructor(
    public readonly label: string,
    message: string,
  ) {
    super(message);
    this.name = "CandidateWriteError";
  }
}

const fail = (label: string, error: { message: string } | null) => {
  if (error) throw new CandidateWriteError(label, error.message);
};

const touch = async (candidateId: string) => {
  const sb = createClient();
  await sb
    .from("candidates")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", candidateId);
};

/**
 * Records what happened, for the History panel.
 *
 * ⚠️ BEST-EFFORT, NEVER FATAL. A failed history line must not fail the thing it
 * describes — refusing to move a candidate because we could not write a note
 * about moving them would be the tail wagging the dog. It logs and moves on.
 */
async function logEvent(candidateId: string, kind: string, detail: string | null, actorId: string | null) {
  try {
    const sb = createClient();
    await sb
      .from("candidate_events")
      .insert({ candidate_id: candidateId, kind, detail, actor_id: actorId });
  } catch (e) {
    console.error("[candidates] event not recorded", kind, e);
  }
}

export interface NewCandidate {
  name: string;
  email?: string | null;
  phone?: string | null;
  roleId?: string | null;
  stageId?: string | null;
  ownerId?: string | null;
  source?: string | null;
  applicationText?: string | null;
  appliedOn?: string | null;
}

export async function createCandidate(input: NewCandidate, actorId: string | null): Promise<string> {
  const sb = createClient();
  const { data, error } = await sb
    .from("candidates")
    .insert({
      name: input.name.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      role_id: input.roleId ?? null,
      stage_id: input.stageId ?? null,
      owner_id: input.ownerId ?? null,
      source: input.source?.trim() || null,
      application_text: input.applicationText?.trim() || null,
      applied_on: input.appliedOn || null,
      created_by: actorId,
    })
    .select("id")
    .single();
  fail("add the candidate", error);
  const id = (data as { id: string }).id;
  await logEvent(id, "created", null, actorId);
  return id;
}

/** Moving between board columns. The drag, and the dropdown on the candidate page. */
export async function moveToStage(
  candidateId: string,
  stageId: string,
  stageName: string,
  actorId: string | null,
) {
  const sb = createClient();
  const { error } = await sb
    .from("candidates")
    .update({ stage_id: stageId, last_activity_at: new Date().toISOString() })
    .eq("id", candidateId);
  fail("move the candidate", error);
  await logEvent(candidateId, "stage_changed", stageName, actorId);
}

/**
 * Off the board — parked, or decided.
 *
 * ⚠️ `stage_id` IS DELIBERATELY LEFT ALONE. Where someone had got to when the
 * decision was made is the most useful thing the archive knows about them —
 * rejected at the phone screen and rejected after a tryout day are different
 * facts, and clearing the stage would erase the difference from 271 rows.
 */
export async function setStatus(
  candidateId: string,
  status: CandidateStatus,
  outcome: CandidateOutcome | null,
  actorId: string | null,
) {
  const sb = createClient();
  const { error } = await sb
    .from("candidates")
    .update({
      status,
      outcome: status === "archived" ? outcome : null,
      archived_at: status === "archived" ? new Date().toISOString() : null,
      archived_by: status === "archived" ? actorId : null,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", candidateId);
  fail("change the candidate's status", error);
  await logEvent(
    candidateId,
    status === "archived" ? "archived" : status === "on_hold" ? "on_hold" : "reopened",
    outcome,
    actorId,
  );
}

export async function updateCandidate(
  candidateId: string,
  patch: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    roleId: string | null;
    ownerId: string | null;
    source: string | null;
    applicationText: string | null;
    appliedOn: string | null;
  }>,
  actorId: string | null,
) {
  const row: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if ("name" in patch) row.name = patch.name;
  if ("email" in patch) row.email = patch.email;
  if ("phone" in patch) row.phone = patch.phone;
  if ("roleId" in patch) row.role_id = patch.roleId;
  if ("ownerId" in patch) row.owner_id = patch.ownerId;
  if ("source" in patch) row.source = patch.source;
  if ("applicationText" in patch) row.application_text = patch.applicationText;
  if ("appliedOn" in patch) row.applied_on = patch.appliedOn;

  const sb = createClient();
  const { error } = await sb.from("candidates").update(row).eq("id", candidateId);
  fail("save the change", error);
  if ("ownerId" in patch) await logEvent(candidateId, "owner_changed", null, actorId);
}

/**
 * ⚠️ DESTROYS THE WHOLE RECORD — interviews, scores, the discussion, the links.
 * Every child table cascades (0039), so there is nothing to put back. The
 * caller confirms with the counts spelled out; archiving is what people
 * actually want nine times in ten.
 */
export async function deleteCandidate(candidateId: string) {
  const sb = createClient();
  const { error } = await sb.from("candidates").delete().eq("id", candidateId);
  fail("delete the candidate", error);
}

// ── links ─────────────────────────────────────────────────────────────────

export async function addLink(
  candidateId: string,
  title: string,
  url: string,
  kind: CandidateLinkKind,
  storagePath: string | null,
  position: number,
) {
  const sb = createClient();
  const { error } = await sb.from("candidate_links").insert({
    candidate_id: candidateId,
    title: title.trim(),
    url,
    kind,
    storage_path: storagePath,
    position,
  });
  fail("add the link", error);
  await touch(candidateId);
}

export async function removeLink(id: string, candidateId: string) {
  const sb = createClient();
  const { error } = await sb.from("candidate_links").delete().eq("id", id);
  fail("remove the link", error);
  await touch(candidateId);
}

// ── interviews and their scores ────────────────────────────────────────────

export async function addInterview(
  candidateId: string,
  kind: string,
  heldOn: string | null,
  interviewerId: string | null,
  actorId: string | null,
): Promise<string> {
  const sb = createClient();
  const { data, error } = await sb
    .from("candidate_interviews")
    .insert({
      candidate_id: candidateId,
      kind: kind.trim() || "Interview",
      held_on: heldOn || null,
      interviewer_id: interviewerId,
      created_by: actorId,
    })
    .select("id")
    .single();
  fail("add the interview", error);
  await touch(candidateId);
  await logEvent(candidateId, "interview_added", kind, actorId);
  return (data as { id: string }).id;
}

export async function updateInterview(
  interviewId: string,
  candidateId: string,
  patch: Partial<{ kind: string; heldOn: string | null; interviewerId: string | null; summary: string | null }>,
) {
  const row: Record<string, unknown> = {};
  if ("kind" in patch) row.kind = patch.kind;
  if ("heldOn" in patch) row.held_on = patch.heldOn;
  if ("interviewerId" in patch) row.interviewer_id = patch.interviewerId;
  if ("summary" in patch) row.summary = patch.summary;
  if (Object.keys(row).length === 0) return;

  const sb = createClient();
  const { error } = await sb.from("candidate_interviews").update(row).eq("id", interviewId);
  fail("save the interview", error);
  await touch(candidateId);
}

export async function removeInterview(interviewId: string, candidateId: string) {
  const sb = createClient();
  const { error } = await sb.from("candidate_interviews").delete().eq("id", interviewId);
  fail("remove the interview", error);
  await touch(candidateId);
}

/**
 * One parameter's score.
 *
 * ⚠️ UPSERT ON THE UNIQUE PAIR, NOT INSERT-THEN-UPDATE. 0039 declares
 * `unique (interview_id, param_id)` precisely so a second click on the same
 * number cannot leave two rows for one question — every average in the app
 * would be quietly wrong and nothing would look broken. Setting a score to
 * null REMOVES the row rather than storing a zero: unscored and scored-badly
 * are different claims and `scoreTone` gives them different colours.
 */
export async function setScore(
  interviewId: string,
  paramId: string,
  value: number | null,
  candidateId: string,
) {
  const sb = createClient();
  if (value === null) {
    const { error } = await sb
      .from("candidate_scores")
      .delete()
      .eq("interview_id", interviewId)
      .eq("param_id", paramId);
    fail("clear the score", error);
  } else {
    const { error } = await sb
      .from("candidate_scores")
      .upsert({ interview_id: interviewId, param_id: paramId, value }, { onConflict: "interview_id,param_id" });
    fail("save the score", error);
  }
  await touch(candidateId);
}

// ── discussion ────────────────────────────────────────────────────────────

export async function addComment(candidateId: string, body: string, authorId: string | null) {
  const sb = createClient();
  const { error } = await sb
    .from("candidate_comments")
    .insert({ candidate_id: candidateId, body: body.trim(), author_id: authorId });
  fail("post the message", error);
  await touch(candidateId);
}

export async function removeComment(id: string, candidateId: string) {
  const sb = createClient();
  const { error } = await sb.from("candidate_comments").delete().eq("id", id);
  fail("delete the message", error);
  await touch(candidateId);
}

// ── settings vocabulary ───────────────────────────────────────────────────

export async function addStage(name: string, position: number) {
  const sb = createClient();
  const { error } = await sb.from("candidate_stages").insert({ name: name.trim(), position });
  fail("add the stage", error);
}

export async function renameStage(id: string, name: string) {
  const sb = createClient();
  const { error } = await sb.from("candidate_stages").update({ name: name.trim() }).eq("id", id);
  fail("rename the stage", error);
}

/**
 * ⚠️ REFUSES WHILE ANYBODY IS STANDING IN IT. `candidates.stage_id` is
 * `on delete set null`, so deleting an occupied stage would not lose the
 * candidates — it would silently drop them off the board into no column at all,
 * which reads exactly like losing them. The caller is told the count instead.
 */
export async function removeStage(id: string): Promise<{ ok: boolean; occupied: number }> {
  const sb = createClient();
  const { count } = await sb
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", id);
  if ((count ?? 0) > 0) return { ok: false, occupied: count ?? 0 };
  const { error } = await sb.from("candidate_stages").delete().eq("id", id);
  fail("remove the stage", error);
  return { ok: true, occupied: 0 };
}

export async function reorderStages(ids: string[]) {
  const sb = createClient();
  // Dense 1..n, the same rule `reorderTask` follows: the seed and the import
  // both leave gaps, and "insert before X" has nothing to open without it.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await sb
      .from("candidate_stages")
      .update({ position: i + 1 })
      .eq("id", ids[i]);
    fail("reorder the stages", error);
  }
}

// ── roles ────────────────────────────────────────────────────────────────
// A role is a TAG, not a structure: the studio hires designers, rarely two
// kinds at once, and plenty of candidates never get one at all.

export async function addRole(name: string, color: string, position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("candidate_roles")
    .insert({ name: name.trim(), color, position });
  fail("add the role", error);
}

export async function updateRole(id: string, patch: { name?: string; color?: string }) {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.color !== undefined) row.color = patch.color;
  if (Object.keys(row).length === 0) return;
  const sb = createClient();
  const { error } = await sb.from("candidate_roles").update(row).eq("id", id);
  fail("save the role", error);
}

/**
 * ⚠️ UNLIKE A STAGE, THIS DOES NOT REFUSE WHILE IN USE — and the asymmetry is
 * the point. `candidates.role_id` is `on delete set null`, so removing a role
 * leaves those people exactly where they are and merely untagged, which is a
 * state the app already handles because plenty of candidates never had one.
 * Removing a STAGE would drop people off the board into no column at all,
 * which is why that one refuses. The caller is still told the count first.
 */
export async function removeRole(id: string): Promise<{ untagged: number }> {
  const sb = createClient();
  const { count } = await sb
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);
  const { error } = await sb.from("candidate_roles").delete().eq("id", id);
  fail("remove the role", error);
  return { untagged: count ?? 0 };
}

export async function roleUsage(id: string): Promise<number> {
  const sb = createClient();
  const { count } = await sb
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);
  return count ?? 0;
}

export async function addSubject(name: string, position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("candidate_score_subjects")
    .insert({ name: name.trim(), position });
  fail("add the subject", error);
}

export async function addParam(subjectId: string, name: string, position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("candidate_score_params")
    .insert({ subject_id: subjectId, name: name.trim(), position });
  fail("add the parameter", error);
}

export async function renameParam(id: string, name: string) {
  const sb = createClient();
  const { error } = await sb
    .from("candidate_score_params")
    .update({ name: name.trim() })
    .eq("id", id);
  fail("rename the parameter", error);
}

/**
 * ⚠️ RETIRES, NEVER DELETES — for subjects and parameters alike. A hard delete
 * cascades to `candidate_scores` (0039), i.e. rewrites what somebody actually
 * thought of a candidate two years ago. Setting `active` false stops it being
 * offered on new scorecards while every historical number still renders.
 */
export async function retireParam(id: string, active: boolean) {
  const sb = createClient();
  const { error } = await sb.from("candidate_score_params").update({ active }).eq("id", id);
  fail("remove the parameter", error);
}

export async function retireSubject(id: string, active: boolean) {
  const sb = createClient();
  const { error } = await sb.from("candidate_score_subjects").update({ active }).eq("id", id);
  fail("remove the subject", error);
}
