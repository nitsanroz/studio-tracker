"use client";

// Every query this section makes, in one place.
//
// See ./types.ts for why candidates are NOT in the global store. The short of
// it: the store boots the whole studio on every page load, this data is
// admin-only and read on two routes, and egress is the tightest constraint this
// project has.
//
// ⚠️ TWO QUERY SHAPES, AND THE SPLIT IS THE POINT. `loadBoard` fetches the
// COLUMNS of the list and nothing else — no interviews, no comments, no
// application text — plus three counts and one average rolled up per candidate.
// `loadCandidate` fetches everything about ONE person. A board of 40 people
// dragging their full histories along would be the boot problem again, one
// route down.

import { createClient } from "../supabase/client";
import { MISSING_SCHEMA_CODES } from "../db";
import type {
  Candidate,
  CandidateComment,
  CandidateDetail,
  CandidateEvent,
  CandidateLink,
  CandidateLinkKind,
  CandidateOutcome,
  CandidateRole,
  CandidateStage,
  CandidateStatus,
  Interview,
  ScoreParam,
  ScoreSubject,
} from "./types";
import { APPLICATION_REVIEW_KIND } from "./types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nstr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function mapStage(r: Row): CandidateStage {
  return { id: str(r.id), name: str(r.name), position: num(r.position) };
}

export function mapRole(r: Row): CandidateRole {
  return {
    id: str(r.id),
    name: str(r.name),
    color: str(r.color) || "#6b7280",
    position: num(r.position),
  };
}

export function mapLink(r: Row): CandidateLink {
  const kind = str(r.kind);
  return {
    id: str(r.id),
    candidateId: str(r.candidate_id),
    title: str(r.title),
    url: str(r.url),
    kind: (kind === "cv" || kind === "portfolio" ? kind : "other") as CandidateLinkKind,
    storagePath: nstr(r.storage_path),
    position: num(r.position),
  };
}

export function mapComment(r: Row): CandidateComment {
  return {
    id: str(r.id),
    candidateId: str(r.candidate_id),
    authorId: nstr(r.author_id),
    authorName: nstr(r.author_name),
    body: str(r.body),
    createdAt: str(r.created_at),
  };
}

export function mapEvent(r: Row): CandidateEvent {
  return {
    id: str(r.id),
    candidateId: str(r.candidate_id),
    kind: str(r.kind),
    detail: nstr(r.detail),
    actorId: nstr(r.actor_id),
    createdAt: str(r.created_at),
  };
}

/**
 * ⚠️ A candidate row arrives WITHOUT its rollups — `interviewCount`, `avgScore`
 * and the rest are filled in by `loadBoard` from separate aggregate reads. The
 * defaults here are what an un-rolled-up row looks like, and `avgScore: null`
 * is deliberately not 0: never scored and scored badly are different facts, and
 * `scoreTone` gives them different colours.
 */
export function mapCandidate(r: Row): Candidate {
  const status = str(r.status);
  const outcome = str(r.outcome);
  return {
    id: str(r.id),
    name: str(r.name),
    email: nstr(r.email),
    phone: nstr(r.phone),
    roleId: nstr(r.role_id),
    stageId: nstr(r.stage_id),
    ownerId: nstr(r.owner_id),
    status: (["active", "on_hold", "archived"].includes(status)
      ? status
      : "active") as CandidateStatus,
    outcome: (["hired", "rejected", "withdrawn"].includes(outcome)
      ? outcome
      : null) as CandidateOutcome | null,
    archivedAt: nstr(r.archived_at),
    source: nstr(r.source),
    applicationText: nstr(r.application_text),
    appliedOn: nstr(r.applied_on),
    lastActivityAt: str(r.last_activity_at),
    createdAt: str(r.created_at),
    interviewCount: 0,
    linkCount: 0,
    commentCount: 0,
    avgScore: null,
  };
}

/** The columns the board and list read. Deliberately not `*`. */
const CANDIDATE_COLS =
  "id,name,email,phone,role_id,stage_id,owner_id,status,outcome,archived_at," +
  "source,application_text,applied_on,last_activity_at,created_at";

export interface Vocabulary {
  stages: CandidateStage[];
  roles: CandidateRole[];
  subjects: ScoreSubject[];
}

/**
 * Stages, roles and the scoring vocabulary. Small, changes rarely, and needed
 * by both routes — so it is one call rather than three scattered ones.
 *
 * ⚠️ RETIRED SUBJECTS AND PARAMETERS ARE FETCHED, NOT FILTERED OUT. A scorecard
 * from 2024 still has to render the parameter it was scored against, even after
 * somebody removes that parameter in Settings. Callers building a NEW card
 * filter on `active` themselves.
 */
/**
 * The scoring subjects, stepping down one column if 0040 has not been applied.
 *
 * ⚠️⚠️ NAMING A COLUMN THAT DOES NOT EXIST FAILS THE WHOLE SELECT, and this
 * one is inside the `Promise.all` that the candidate page and the board both
 * wait on — so before the ladder existed, an unapplied 0040 rendered as
 * "Could not load this candidate" on every dossier. Measured, not reasoned
 * about: that is exactly what it did.
 *
 * ⚠️ It steps down ONLY on a missing-schema code. Any other failure must
 * propagate — a network blip read as "the column is gone" would quietly show
 * Personality on every application scorecard with nothing saying why.
 */
async function subjectRows(sb: ReturnType<typeof createClient>) {
  const full = await sb
    .from("candidate_score_subjects")
    .select("id,name,position,active,from_submission")
    .order("position");
  if (!full.error || !MISSING_SCHEMA_CODES.has(full.error.code ?? "")) return full;
  return sb.from("candidate_score_subjects").select("id,name,position,active").order("position");
}

export async function loadVocabulary(): Promise<Vocabulary> {
  const sb = createClient();
  const [stages, roles, subjects, params] = await Promise.all([
    sb.from("candidate_stages").select("id,name,position").order("position"),
    sb.from("candidate_roles").select("id,name,color,position").order("position"),
    subjectRows(sb),
    sb
      .from("candidate_score_params")
      .select("id,subject_id,name,position,active")
      .order("position"),
  ]);
  if (stages.error) throw stages.error;
  if (roles.error) throw roles.error;
  if (subjects.error) throw subjects.error;
  if (params.error) throw params.error;

  const bySubject = new Map<string, ScoreParam[]>();
  for (const p of (params.data ?? []) as Row[]) {
    const sid = str(p.subject_id);
    const list = bySubject.get(sid) ?? [];
    list.push({
      id: str(p.id),
      subjectId: sid,
      name: str(p.name),
      position: num(p.position),
      active: p.active !== false,
    });
    bySubject.set(sid, list);
  }

  return {
    stages: ((stages.data ?? []) as Row[]).map(mapStage),
    roles: ((roles.data ?? []) as Row[]).map(mapRole),
    subjects: ((subjects.data ?? []) as Row[]).map((s) => ({
      id: str(s.id),
      name: str(s.name),
      position: num(s.position),
      active: s.active !== false,
      // Absent means true — the column is `default true` (0040), and a client
      // reading a project where the migration has not landed yet should show
      // every subject rather than hide the studio's scoring vocabulary.
      fromSubmission: s.from_submission !== false,
      params: bySubject.get(str(s.id)) ?? [],
    })),
  };
}

export interface BoardCounts {
  active: number;
  onHold: number;
  archived: number;
}

/**
 * The candidates in one status, with their rollups.
 *
 * ⚠️ THE ROLLUPS ARE THREE EXTRA READS, NOT A JOIN PER ROW. PostgREST can embed
 * children, but embedding `candidate_interviews(...)` on a board of 40 people
 * pulls every summary they contain — paragraphs of text, to render a count. So
 * the ids are collected and each child table is asked once, keyed back in
 * memory. Four round trips instead of one, and a fraction of the bytes.
 */
export async function loadBoard(
  status: CandidateStatus,
): Promise<{ candidates: Candidate[]; counts: BoardCounts }> {
  const sb = createClient();

  const [rows, activeC, holdC, archC] = await Promise.all([
    sb
      .from("candidates")
      .select(CANDIDATE_COLS)
      .eq("status", status)
      .order("last_activity_at", { ascending: false }),
    sb.from("candidates").select("id", { count: "exact", head: true }).eq("status", "active"),
    sb.from("candidates").select("id", { count: "exact", head: true }).eq("status", "on_hold"),
    sb.from("candidates").select("id", { count: "exact", head: true }).eq("status", "archived"),
  ]);
  if (rows.error) throw rows.error;

  const candidates = ((rows.data ?? []) as unknown as Row[]).map(mapCandidate);
  const counts: BoardCounts = {
    active: activeC.count ?? 0,
    onHold: holdC.count ?? 0,
    archived: archC.count ?? 0,
  };
  if (candidates.length === 0) return { candidates, counts };

  const ids = candidates.map((c) => c.id);
  const [links, comments, interviews] = await Promise.all([
    sb.from("candidate_links").select("candidate_id").in("candidate_id", ids),
    sb.from("candidate_comments").select("candidate_id").in("candidate_id", ids),
    sb.from("candidate_interviews").select("id,candidate_id,kind").in("candidate_id", ids),
  ]);

  const tally = (rowsIn: Row[] | null) => {
    const m = new Map<string, number>();
    for (const r of rowsIn ?? []) {
      const k = str(r.candidate_id);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const linkN = tally(links.data as Row[] | null);
  const commentN = tally(comments.data as Row[] | null);
  // ⚠️ THE APPLICATION REVIEW IS NOT AN INTERVIEW ON THE CARD. It is a reading
  // of the portfolio, so "2 interviews" on a board card would claim two
  // conversations that never happened. Its SCORES still count below — the
  // opinion is real, the meeting is not.
  const interviewN = tally(
    ((interviews.data ?? []) as Row[]).filter((r) => str(r.kind) !== APPLICATION_REVIEW_KIND),
  );

  // Scores hang off the INTERVIEW, so the candidate they belong to has to be
  // walked back through the interview ids we just read.
  const interviewOwner = new Map<string, string>();
  for (const r of (interviews.data ?? []) as Row[]) {
    interviewOwner.set(str(r.id), str(r.candidate_id));
  }
  const scoreSum = new Map<string, { total: number; n: number }>();
  if (interviewOwner.size > 0) {
    const scores = await sb
      .from("candidate_scores")
      .select("interview_id,value")
      .in("interview_id", [...interviewOwner.keys()]);
    for (const r of (scores.data ?? []) as Row[]) {
      const cid = interviewOwner.get(str(r.interview_id));
      if (!cid) continue;
      const acc = scoreSum.get(cid) ?? { total: 0, n: 0 };
      acc.total += num(r.value);
      acc.n += 1;
      scoreSum.set(cid, acc);
    }
  }

  for (const c of candidates) {
    c.linkCount = linkN.get(c.id) ?? 0;
    c.commentCount = commentN.get(c.id) ?? 0;
    c.interviewCount = interviewN.get(c.id) ?? 0;
    const s = scoreSum.get(c.id);
    c.avgScore = s && s.n > 0 ? s.total / s.n : null;
  }

  return { candidates, counts };
}

/** Everything about one person. One route, one candidate, so `*` is honest here. */
export async function loadCandidate(id: string): Promise<CandidateDetail | null> {
  const sb = createClient();
  const { data, error } = await sb
    .from("candidates")
    .select(CANDIDATE_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const candidate = mapCandidate(data as unknown as Row);
  const [links, interviews, comments, events] = await Promise.all([
    sb.from("candidate_links").select("*").eq("candidate_id", id).order("position"),
    sb
      .from("candidate_interviews")
      .select("*")
      .eq("candidate_id", id)
      .order("held_on", { ascending: true, nullsFirst: false }),
    sb.from("candidate_comments").select("*").eq("candidate_id", id).order("created_at"),
    sb
      .from("candidate_events")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const interviewRows = (interviews.data ?? []) as Row[];
  const scoresByInterview = new Map<string, Record<string, number>>();
  if (interviewRows.length > 0) {
    const { data: scoreRows } = await sb
      .from("candidate_scores")
      .select("interview_id,param_id,value")
      .in(
        "interview_id",
        interviewRows.map((r) => str(r.id)),
      );
    for (const r of (scoreRows ?? []) as Row[]) {
      const iid = str(r.interview_id);
      const map = scoresByInterview.get(iid) ?? {};
      map[str(r.param_id)] = num(r.value);
      scoresByInterview.set(iid, map);
    }
  }

  const mapped: Interview[] = interviewRows.map((r) => ({
    id: str(r.id),
    candidateId: str(r.candidate_id),
    kind: str(r.kind),
    heldOn: nstr(r.held_on),
    heldAtTime: nstr(r.held_at_time),
    interviewerId: nstr(r.interviewer_id),
    summary: nstr(r.summary),
    createdAt: str(r.created_at),
    scores: scoresByInterview.get(str(r.id)) ?? {},
  }));

  const counts = {
    linkCount: (links.data ?? []).length,
    commentCount: (comments.data ?? []).length,
    // Same rule as the board — see the ⚠️ in `loadBoard`.
    interviewCount: mapped.filter((i) => i.kind !== APPLICATION_REVIEW_KIND).length,
  };
  // Every score the person has been given, across every interview. Flat rather
  // than a mean of means: two interviews scored on 4 and 11 parameters are not
  // equally weighted claims, and averaging their averages would pretend they
  // were.
  const flat = mapped.flatMap((i) => Object.values(i.scores));

  return {
    candidate: {
      ...candidate,
      ...counts,
      avgScore: flat.length > 0 ? flat.reduce((a, b) => a + b, 0) / flat.length : null,
    },
    links: ((links.data ?? []) as Row[]).map(mapLink),
    interviews: mapped,
    comments: ((comments.data ?? []) as Row[]).map(mapComment),
    events: ((events.data ?? []) as Row[]).map(mapEvent),
  };
}
