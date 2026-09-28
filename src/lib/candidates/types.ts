// Candidate tracking — the shapes, and why this section keeps its own.
//
// ⚠️⚠️ THIS DOMAIN DELIBERATELY DOES NOT LIVE IN `src/lib/store/`, WHICH IS A
// DEPARTURE FROM EVERY OTHER FEATURE IN THE APP. Read this before "fixing" it.
//
// The store boots the whole studio into memory on every page load and then
// refreshes it on a timer, which is what made egress the tightest constraint
// this project has (v1.18.2 / v1.19.11 / v1.37.0: 200% of the allowance, a
// hard 402 that took the client report links down, and two releases spent
// moving tables onto slower tiers). Adding ten more tables to that boot would
// charge every designer, on every page, for data that:
//
//   (a) is ADMIN-ONLY at the RLS level, so a designer's copy of the query comes
//       back empty and is pure waste; and
//   (b) is read on exactly two routes, by two people.
//
// So candidates are fetched by the pages that show them, scoped to what is on
// screen. The cost is that there is no cross-page cache and no undo/redo here —
// both acceptable for a section two admins open a few times a week, and neither
// worth re-opening the egress fight for.

export type CandidateStatus = "active" | "on_hold" | "archived";
export type CandidateOutcome = "hired" | "rejected" | "withdrawn";
export type CandidateLinkKind = "cv" | "portfolio" | "other";

export interface CandidateStage {
  id: string;
  name: string;
  position: number;
}

export interface CandidateRole {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface CandidateLink {
  id: string;
  candidateId: string;
  title: string;
  url: string;
  kind: CandidateLinkKind;
  /** Set only when we hold the bytes; null for a link to somebody else's site. */
  storagePath: string | null;
  position: number;
}

export interface ScoreSubject {
  id: string;
  name: string;
  position: number;
  /** Retired subjects still render on old scorecards; see 0039. */
  active: boolean;
  params: ScoreParam[];
}

export interface ScoreParam {
  id: string;
  subjectId: string;
  name: string;
  position: number;
  active: boolean;
}

export interface Interview {
  id: string;
  candidateId: string;
  /** Free text, NOT a stage id — renaming a column must not retitle history. */
  kind: string;
  heldOn: string | null;
  heldAtTime: string | null;
  interviewerId: string | null;
  summary: string | null;
  createdAt: string;
  /** param id → 1-10. Absent means "not scored", which is not the same as 0. */
  scores: Record<string, number>;
}

export interface CandidateComment {
  id: string;
  candidateId: string;
  authorId: string | null;
  /** Falls back to this when the author has no profile — see 0039's note. */
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface CandidateEvent {
  id: string;
  candidateId: string;
  kind: string;
  detail: string | null;
  actorId: string | null;
  createdAt: string;
}

/** The row as the board and the list need it — no interviews, no comments. */
export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleId: string | null;
  stageId: string | null;
  ownerId: string | null;
  status: CandidateStatus;
  outcome: CandidateOutcome | null;
  archivedAt: string | null;
  source: string | null;
  applicationText: string | null;
  appliedOn: string | null;
  lastActivityAt: string;
  createdAt: string;
  /** Rolled up by the list query so a board card can show a figure. */
  interviewCount: number;
  linkCount: number;
  commentCount: number;
  /** Mean of every score across every interview, or null if never scored. */
  avgScore: number | null;
}

/** Everything the candidate page renders. One fetch per candidate. */
export interface CandidateDetail {
  candidate: Candidate;
  links: CandidateLink[];
  interviews: Interview[];
  comments: CandidateComment[];
  events: CandidateEvent[];
}

/**
 * The average of one interview's scores, or null when nothing was scored.
 *
 * ⚠️ AN UNSCORED PARAMETER IS ABSENT, NEVER ZERO. Treating a blank as 0 would
 * drag an otherwise strong interview down by however many questions the
 * interviewer skipped, which is the opposite of what skipping one means.
 */
export function interviewAverage(scores: Record<string, number>): number | null {
  const values = Object.values(scores);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The average within one subject, for the column heading on a scorecard. */
export function subjectAverage(
  subject: ScoreSubject,
  scores: Record<string, number>,
): number | null {
  const values = subject.params
    .map((p) => scores[p.id])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * One decimal, and never a trailing `.0` dropped — a score is read beside other
 * scores, so `8` and `8.0` in the same column read as different precisions.
 */
export function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/**
 * The one figure that stands for a candidate: every score anybody has given
 * them, weighted so that later readings count for more.
 *
 * ⚠️ WHY WEIGHTED AT ALL. A phone screen and a physical interview are not
 * equally informed opinions — the second person has met them, seen the work
 * and had the first person's notes in front of them. A flat mean says
 * otherwise, so a strong interview never quite recovers from a lukewarm first
 * call.
 *
 * ⚠️ THE WEIGHTS ARE LINEAR (1, 2, 3 … oldest to newest), NOT EXPONENTIAL.
 * Doubling each time gives the newest reading 53% of the answer by the fourth
 * interview and 94% by the eighth, which is not "more weight to the latest" —
 * it is throwing the earlier ones away.
 *
 * ⚠️ WORKED THROUGH RATHER THAN ASSERTED, because the first draft of this
 * comment claimed something the arithmetic did not support. Scores of 8, 8, 8
 * then 2 come out at 5.6 — against 6.5 for a flat mean and 4.8 for doubling.
 * So a bad last interview DOES pull the figure below the middle, which is
 * right (it is the most informed reading), while three good ones stop it
 * landing anywhere near the 2. With two interviews it is a third against two
 * thirds, about what a physical interview is worth against a phone call.
 *
 * ⚠️ AN INTERVIEW WITH NO SCORES IS SKIPPED, not counted as zero. A card
 * somebody opened and never filled in holds no opinion, and letting it drag
 * the figure down would punish scheduling an interview.
 *
 * ⚠️ Ordered by when the interview HAPPENED (`heldOn`), falling back to when
 * the card was made. An undated card added today is the most recent thing we
 * know, so it sorts last rather than first.
 */
export function overallScore(interviews: Interview[]): number | null {
  const scored = interviews
    .map((i) => ({ at: i.heldOn ?? i.createdAt, avg: interviewAverage(i.scores) }))
    .filter((x): x is { at: string; avg: number } => x.avg !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (scored.length === 0) return null;

  let weighted = 0;
  let total = 0;
  scored.forEach((x, i) => {
    const w = i + 1;
    weighted += x.avg * w;
    total += w;
  });
  return weighted / total;
}

/**
 * The colour band a score is shown in. Deliberately three bands and not a
 * gradient: the question a reader asks is "is this good", and a continuous
 * scale answers it more slowly than three does.
 */
export function scoreTone(value: number | null): "none" | "low" | "mid" | "high" {
  if (value === null) return "none";
  if (value >= 8) return "high";
  if (value >= 6) return "mid";
  return "low";
}

/**
 * ⚠️ A candidate is on the board only while `active`. On hold and archived both
 * leave it — the first is a park, the second is a decision — and both stay
 * reachable through their own filters. This is the rule the Asana board did not
 * have, and the reason its widest column held 140 rejected people.
 */
export function isOnBoard(c: Candidate): boolean {
  return c.status === "active";
}
