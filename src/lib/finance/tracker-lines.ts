// New in the tracker (v1.15.0, Nitsan 2026-11-05): people the tracker has
// that finance has no line for yet, offered as a line to add on Salaries or
// Freelance. People are made in studio-tracker (Team → Add user, Freelancers
// → Add a freelancer, a candidate's "Convert to…"), and finance never writes
// tracker tables — so finance only hears of a new person by looking.
//
// Pure: the card (components/tracker-lines.tsx) loads, this decides.
// Clients are not here: a new tracker client already gets the rate prompt
// (components/new-clients.tsx), which also makes its Plan row.

export type LineKind = "salaries" | "freelance";

export interface TrackerPerson {
  id: string;
  name: string;
  active: boolean;
  hasAccount: boolean;
  /** "owner" marks the studio owner — never a salary line. */
  position: string | null;
  /** YYYY-MM-DD, when known. */
  startDate: string | null;
}

export interface TrackerFreelancer {
  profileId: string;
  /** When the tracker's `freelancers` row was made (ISO). */
  createdAt: string;
}

/** Every row the finance table holds, any year: who it belongs to. */
export interface FinanceLine {
  name: string;
  profileId: string | null;
}

export interface Suggestion {
  profileId: string;
  name: string;
  /** The month the new line starts — when they started, never before this year. */
  year: number;
  month: number;
  /** Why they're offered, in a few words. */
  reason: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The line's first month: their start, clamped to this year (a past year is closed). */
function startOf(iso: string | null, today: Date): { year: number; month: number } {
  const y = today.getFullYear();
  if (!iso) return { year: y, month: today.getMonth() + 1 };
  const [sy, sm] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  if (!Number.isInteger(sy) || !Number.isInteger(sm) || sm < 1 || sm > 12) return { year: y, month: today.getMonth() + 1 };
  if (sy < y) return { year: y, month: 1 };
  return { year: sy, month: sm };
}

/**
 * Who to offer a line to.
 *
 * - **Freelance:** everyone in the tracker's `freelancers` (link or login).
 * - **Salaries:** active members with a login, except the owner and anyone
 *   billed as a freelancer (Dima has a login but is paid on Freelance).
 *
 * ⚠️ A person already has a line if ANY row of this table, in any year, is
 * theirs — by `profile_id`, or by name (case and spacing aside), because some
 * rows are deliberately not linked (AB's). Dismissed ids are left out.
 */
export function suggestLines(
  kind: LineKind,
  people: TrackerPerson[],
  freelancers: TrackerFreelancer[],
  lines: FinanceLine[],
  ignored: Set<string>,
  today: Date = new Date(),
): Suggestion[] {
  const linked = new Set(lines.map((l) => l.profileId).filter((id): id is string => !!id));
  const named = new Set(lines.map((l) => norm(l.name)));
  const has = (p: TrackerPerson) => linked.has(p.id) || named.has(norm(p.name));
  const byId = new Map(people.map((p) => [p.id, p]));
  const freelanceIds = new Set(freelancers.map((f) => f.profileId));
  const out: Suggestion[] = [];

  if (kind === "freelance") {
    for (const f of freelancers) {
      const p = byId.get(f.profileId);
      if (!p || ignored.has(p.id) || has(p)) continue;
      out.push({ profileId: p.id, name: p.name, ...startOf(f.createdAt.slice(0, 10), today), reason: "Freelancer in the tracker" });
    }
  } else {
    for (const p of people) {
      if (!p.active || !p.hasAccount || p.position === "owner" || freelanceIds.has(p.id)) continue;
      if (ignored.has(p.id) || has(p)) continue;
      out.push({ profileId: p.id, name: p.name, ...startOf(p.startDate, today), reason: "Team member in the tracker" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
