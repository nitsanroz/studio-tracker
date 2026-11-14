// How one check's findings meet the stored rows (v1.80.0) — ONE copy since the
// finance merge (stage 4): the studio's rules, the money rules and the rules
// that read both all land in `finance_advice_items` through here.
//
// ⚠️ PURE — the engine does the reads and writes; this decides them, which is
// what lets snooze, done and escalation be tested without a database.
//
// The rules, all Nitsan's (2026-10-24):
// - A finding seen again is the same row: its figures update, its state stays.
// - A row no check finds any more is resolved — the automatic "done".
// - Any item can be snoozed or dismissed (2026-10-25 — it was snooze-only for
//   advice; "Dmitry has 2 days with no hours" needs to go away). A reminder's
//   dismiss reads "Mark done". Both are `done_at`.
// - Either one breaks when the finding gets WORSE (severity rises above the
//   level it was hidden at): the row comes back, marked as changed.

import type { AdviceKind, FindingLink } from "./signals";
import type { Fix } from "@/lib/finance/advice/signals";

/**
 * What a rule hands over, whichever side wrote it. The studio's rules
 * (signals.ts) may carry a `list`; the money rules (lib/finance/advice) a
 * `figure` chip, a `focus` to light up on the page, and a one-click `fix`.
 */
export interface Finding {
  key: string;
  signal: string;
  kind: AdviceKind;
  area: string;
  clientId: string | null;
  severity: number;
  facts: Record<string, string | number | null>;
  title: string;
  body: string;
  reminder: boolean;
  href: string;
  action: string;
  list?: FindingLink[];
  figure?: string | null;
  focus?: string;
  fix?: Fix;
}

export interface AdviceRow {
  id: string;
  key: string;
  signal: string;
  kind: AdviceKind;
  area: string;
  clientId: string | null;
  severity: number;
  /** the finding's facts, plus `href`/`action`, `changed`, and `list` (the things it links);
   *  an idea's facts hold `basedOn`, the keys of the findings it was written from */
  facts: Record<string, string | number | boolean | null | FindingLink[] | string[]>;
  title: string;
  body: string;
  wordedTitle: string | null;
  wordedBody: string | null;
  isReminder: boolean;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  doneAt: string | null;
  snoozedUntil: string | null;
  snoozedAtSeverity: number | null;
}

/** What to write: new rows, changed rows (by id), and ids to resolve. */
export interface MergePlan {
  insert: Omit<AdviceRow, "id">[];
  update: { id: string; patch: Partial<AdviceRow> }[];
  resolve: string[];
}

/** JSON with every object's keys sorted, at any depth. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);

/**
 * Same facts, whatever the key order — Postgres jsonb stores keys in its own
 * order (inside a list's items too), so a plain JSON.stringify would call every
 * stored row "changed".
 */
function sameFacts(a: AdviceRow["facts"], b: AdviceRow["facts"]): boolean {
  return stable(a) === stable(b);
}

function factsOf(f: Finding): AdviceRow["facts"] {
  return {
    ...f.facts,
    // A money rule always states its figure (null = none); a studio rule has no such key.
    ...(f.figure !== undefined ? { figure: f.figure } : {}),
    href: f.href,
    action: f.action,
    ...(f.list?.length ? { list: f.list } : {}),
    ...(f.focus ? { focus: f.focus } : {}),
    ...(f.fix ? { fix: JSON.stringify(f.fix) } : {}),
  };
}

/** Signals Claude writes, not the rules: never reworded, never resolved by a check alone. */
export const NOT_FROM_RULES = new Set(["idea", "tools"]);

/**
 * Ideas come from the daily Claude run, not from the rules, so a rule check
 * never resolves them on its own — the next run replaces them. EXCEPT when a
 * finding an idea was written from goes away (`facts.basedOn`): the idea then
 * quotes something no longer true, so it goes with it. Hit 2026-11-10: the
 * 06:40 run wrote "the payment is also 13 days late" from NoTraffic's unpaid
 * finding, the finding resolved at 09:07 once October read as Paid, and the
 * idea kept saying it all day.
 *
 * "tools" items are the owner's "Review the tools" run (lib/finance/advice/
 * review.ts): never resolved here, replaced by the next review.
 */
export function mergeFindings(rows: AdviceRow[], findings: Finding[], nowIso: string): MergePlan {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const plan: MergePlan = { insert: [], update: [], resolve: [] };
  const seen = new Set<string>();

  for (const f of findings) {
    seen.add(f.key);
    const row = byKey.get(f.key);
    const facts = factsOf(f);
    if (!row) {
      plan.insert.push({
        key: f.key,
        signal: f.signal,
        kind: f.kind,
        area: f.area,
        clientId: f.clientId,
        severity: f.severity,
        facts,
        title: f.title,
        body: f.body,
        wordedTitle: null,
        wordedBody: null,
        isReminder: f.reminder,
        firstSeen: nowIso,
        lastSeen: nowIso,
        resolvedAt: null,
        doneAt: null,
        snoozedUntil: null,
        snoozedAtSeverity: null,
      });
      continue;
    }
    const patch: Partial<AdviceRow> = {
      kind: f.kind,
      area: f.area,
      severity: f.severity,
      facts,
      title: f.title,
      body: f.body,
      isReminder: f.reminder,
      lastSeen: nowIso,
      resolvedAt: null,
    };
    // Claude's wording described the old figures; drop it when they change.
    if (f.title !== row.title || f.body !== row.body) {
      patch.wordedTitle = null;
      patch.wordedBody = null;
    }
    const hidden = row.doneAt != null || row.snoozedUntil != null;
    if (hidden && row.snoozedAtSeverity != null && f.severity > row.snoozedAtSeverity) {
      patch.doneAt = null;
      patch.snoozedUntil = null;
      patch.snoozedAtSeverity = null;
      patch.facts = { ...facts, changed: true };
    } else if (row.facts.changed) {
      patch.facts = { ...facts, changed: true };
    }
    // Unchanged → no write. The pane re-checks on every open, and rewriting
    // every row each time was a dozen round trips for nothing. `lastSeen` only
    // moves with a real change (nothing reads it for more than that).
    const unchanged =
      !row.resolvedAt &&
      row.kind === f.kind &&
      row.area === f.area &&
      row.severity === f.severity &&
      row.title === f.title &&
      row.body === f.body &&
      row.isReminder === f.reminder &&
      sameFacts(row.facts, patch.facts!);
    if (!unchanged) plan.update.push({ id: row.id, patch });
  }

  for (const r of rows) {
    if (r.resolvedAt || seen.has(r.key)) continue;
    if (r.signal === "tools") continue;
    if (r.signal === "idea") {
      const basedOn = r.facts.basedOn;
      if (Array.isArray(basedOn) && basedOn.some((k) => typeof k === "string" && !seen.has(k))) plan.resolve.push(r.id);
      continue;
    }
    plan.resolve.push(r.id);
  }
  return plan;
}

/** The stored rows after `plan`, without reading them back. */
export function applyPlan(rows: AdviceRow[], plan: MergePlan, inserted: AdviceRow[], nowIso: string): AdviceRow[] {
  const patches = new Map(plan.update.map((u) => [u.id, u.patch]));
  const resolved = new Set(plan.resolve);
  return [
    ...rows.map((r) => ({ ...r, ...patches.get(r.id), ...(resolved.has(r.id) ? { resolvedAt: nowIso } : {}) })),
    ...inserted,
  ];
}

/** Rows the pane shows today: open, not done, not snoozed past today. */
export function visible(rows: AdviceRow[], today: string): AdviceRow[] {
  const order: Record<AdviceKind, number> = { now: 0, heads: 1, idea: 2 };
  return rows
    .filter((r) => !r.resolvedAt && !r.doneAt && (!r.snoozedUntil || r.snoozedUntil <= today))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.severity - a.severity || a.firstSeen.localeCompare(b.firstSeen));
}

/* ── row ↔ database ─────────────────────────────────────────────────────── */

type Db = Record<string, unknown>;

export const mapAdviceRow = (r: Db): AdviceRow => ({
  id: String(r.id),
  key: String(r.key),
  signal: String(r.signal),
  kind: r.kind as AdviceKind,
  area: String(r.area),
  clientId: (r.client_id as string | null) ?? null,
  severity: Number(r.severity),
  facts: (r.facts as AdviceRow["facts"]) ?? {},
  title: String(r.title),
  body: String(r.body),
  wordedTitle: (r.worded_title as string | null) ?? null,
  wordedBody: (r.worded_body as string | null) ?? null,
  isReminder: Boolean(r.is_reminder),
  firstSeen: String(r.first_seen),
  lastSeen: String(r.last_seen),
  resolvedAt: (r.resolved_at as string | null) ?? null,
  doneAt: (r.done_at as string | null) ?? null,
  snoozedUntil: (r.snoozed_until as string | null) ?? null,
  snoozedAtSeverity: r.snoozed_at_severity == null ? null : Number(r.snoozed_at_severity),
});

const COLUMN: Record<keyof Omit<AdviceRow, "id">, string> = {
  key: "key",
  signal: "signal",
  kind: "kind",
  area: "area",
  clientId: "client_id",
  severity: "severity",
  facts: "facts",
  title: "title",
  body: "body",
  wordedTitle: "worded_title",
  wordedBody: "worded_body",
  isReminder: "is_reminder",
  firstSeen: "first_seen",
  lastSeen: "last_seen",
  resolvedAt: "resolved_at",
  doneAt: "done_at",
  snoozedUntil: "snoozed_until",
  snoozedAtSeverity: "snoozed_at_severity",
};

export function toDb(patch: Partial<AdviceRow>): Db {
  const out: Db = {};
  for (const [k, v] of Object.entries(patch)) if (k !== "id") out[COLUMN[k as keyof typeof COLUMN]] = v;
  return out;
}
