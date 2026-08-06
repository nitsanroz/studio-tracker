// The studio's data as one fetchable snapshot, so the store can load it on boot
// AND re-load it in the background without two copies of the query drifting apart.
//
// Split into HOT (changes minute to minute, refreshed often) and COLD (the studio's
// structure — people, clients, sections, tags — refreshed rarely), because a hot
// tick every minute over the full boot set is a lot of full-table reads for data
// that changes a few times a week.
//
// ⚠️ The two column-degradation ladders below were moved here character-for-character
// from the boot query and must stay that way. They step down ONLY on a genuinely
// missing column (`isMissingSchema`); collapsing on any error would drop the
// `legacy` flag, and without it ~4,000h of pre-Everhour backfill reads as ordinary
// logged time in days-worked, tenure, "my hours" and the feed timesheet.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAll,
  isMissingSchema,
  mapBillingPeriod,
  mapClient,
  mapDayState,
  mapDevItem,
  mapEntrySum,
  mapLink,
  mapTaskType,
  mapPlanColumn,
  mapPlanEntry,
  mapProfile,
  mapSection,
  mapTag,
  mapTask,
  mapTimeEntry,
  type DbRow,
} from "./db";
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
  Section,
  Tag,
  Task,
  TaskType,
  TimeEntry,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- DB boundary; the exported shapes are explicit */
type Sb = SupabaseClient<any, any, any>;

/** Studio structure. Changes a few times a week. */
export interface ColdSnapshot {
  profiles: Profile[];
  clients: Client[];
  sections: Section[];
  tags: Tag[];
  planColumns: PlanColumn[];
  billingPeriods: BillingPeriod[];
  dayStates: DayState[];
  /** titled reference links on tasks and clients (0022) */
  links: Link[];
  /** kinds of work, with their colours (0024) */
  taskTypes: TaskType[];
  /** projects → client_id, needed by mapTask/mapSection on pre-0007 data */
  projectClient: Map<string, string>;
}

/** Work in flight. Changes minute to minute. */
export interface HotSnapshot {
  tasks: Task[];
  planEntries: PlanEntry[];
  /** the recent-400 feed window */
  timeEntries: TimeEntry[];
  entrySums: EntrySum[];
  taskRequests: DbRow[];
  devItems: DevItem[];
}

/** What `fetchHot` needs from the cold half to map its rows. */
export interface HotCtx {
  tagNames: Map<string, string>;
  projectClient: Map<string, string>;
}

export async function fetchCold(sb: Sb): Promise<ColdSnapshot> {
  const [prof, cli, projLegacy, sec, tagsRes, cols, periods, days, linkRows, typeRows] =
    await Promise.all([
    // "*" keeps boot working whether or not migration 0004 is applied
    fetchAll<DbRow>(sb, "profiles", "*"),
    fetchAll<DbRow>(sb, "clients", "*"),
    // legacy layer: only used to derive client_id before migration 0007
    fetchAll<DbRow>(sb, "projects", "id, client_id"),
    // "*" tolerates pre-0007 schema (no client_id column yet)
    fetchAll<DbRow>(sb, "sections", "*"),
    sb.from("tags").select("*").order("position"),
    fetchAll<DbRow>(sb, "plan_columns", "*"),
    // pre-0007 these tables don't exist; RLS hides them from designers
    fetchAll<DbRow>(sb, "client_billing_periods", "*").catch(() => [] as DbRow[]),
    fetchAll<DbRow>(sb, "plan_day_states", "*").catch(() => [] as DbRow[]),
    // the whole table doesn't exist until 0022; an empty list simply means
    // "no links anywhere", which is exactly how the app renders it
    fetchAll<DbRow>(sb, "links", "*").catch(() => [] as DbRow[]),
    // absent until 0024; an empty list simply means "no types defined"
    fetchAll<DbRow>(sb, "task_types", "*").catch(() => [] as DbRow[]),
  ]);

  const projectClient = new Map<string, string>(
    projLegacy.map((p) => [p.id as string, p.client_id as string]),
  );
  return {
    profiles: prof.map(mapProfile),
    clients: cli.map(mapClient),
    sections: sec.map((r) => mapSection(r, projectClient)),
    tags: ((tagsRes.data ?? []) as DbRow[]).map(mapTag),
    planColumns: cols.map(mapPlanColumn),
    billingPeriods: periods
      .map(mapBillingPeriod)
      .sort((a: BillingPeriod, b: BillingPeriod) => a.dateFrom.localeCompare(b.dateFrom)),
    dayStates: days.map(mapDayState),
    links: linkRows.map(mapLink).sort((a: Link, b: Link) => a.position - b.position),
    taskTypes: typeRows.map(mapTaskType).sort((a: TaskType, b: TaskType) => a.position - b.position),
    projectClient,
  };
}

export async function fetchHot(sb: Sb, ctx: HotCtx): Promise<HotSnapshot> {
  const [pe, taskRows, sums, feed, requests, dev] = await Promise.all([
    fetchAll<DbRow>(sb, "plan_entries", "*"),
    (async () => {
      const cols =
        "id, project_id, section_id, title, figma_url, status, tag_id, assignee_id, due_date, billable, estimate_hours, position, pending";
      // 0016 adds the recovered pre-Everhour history columns
      const legacyCols = "legacy_hours, legacy_title, activity_from, activity_to";
      // 0022 adds the timeline's left edge. Its own rung, so a studio that
      // hasn't run 0022 yet keeps the legacy columns — dropping those is the
      // expensive mistake this ladder exists to avoid.
      const startCol = "start_date";
      // 0023 adds the Timeline's row order. Its own rung again, for the same
      // reason: each new column must be able to fall away without taking the
      // rungs below it with it.
      const orderCol = "timeline_position";
      // 0024 adds the kind-of-work colour the Timeline paints with.
      const typeCol = "type_id";
      // Only step down when the column is genuinely absent (isMissingSchema);
      // anything else — a dropped connection, an RLS change — must surface
      // rather than quietly serve a reduced app. See DbError in db.ts.
      for (const select of [
        `client_id, ${typeCol}, ${orderCol}, ${startCol}, ${legacyCols}, ${cols}`, // + 0024
        `client_id, ${orderCol}, ${startCol}, ${legacyCols}, ${cols}`, // + 0023
        `client_id, ${startCol}, ${legacyCols}, ${cols}`, // post-0007 + 0016 + 0022
        `client_id, ${legacyCols}, ${cols}`, // post-0007 + post-0016
        `client_id, ${cols}`, // post-0007
        cols, // pre-0007
      ]) {
        try {
          return await fetchAll<DbRow>(sb, "tasks", select);
        } catch (e) {
          if (!isMissingSchema(e)) throw e;
        }
      }
      throw new Error("tasks: could not load with any known column set");
    })(),
    (async () => {
      const cols = "id, task_id, user_id, date, minutes";
      const notNull = "minutes";
      // Degrade ONE column at a time. Collapsing straight to `cols` on any
      // failure would drop `legacy` as well, and without that flag the
      // ~4,000h of 2016–2022 backfill reads as ordinary logged time — it
      // would land in days-worked, tenure, "my hours" and the feed timesheet,
      // which is precisely what the flag exists to prevent.
      for (const extra of [", legacy, date_estimated", ", legacy", ""]) {
        try {
          return await fetchAll<DbRow>(sb, "time_entries", `${cols}${extra}`, (q) =>
            q.not(notNull, "is", null),
          );
        } catch (e) {
          // A missing column means the migration isn't applied — step down.
          // Any other failure must NOT be read as "the column is gone",
          // or a network blip drops the `legacy` flag and the backfill
          // leaks into every personal figure on the site.
          if (!isMissingSchema(e)) throw e;
        }
      }
      throw new Error("time_entries: could not load with any known column set");
    })(),
    sb
      .from("time_entries")
      .select("*")
      .not("minutes", "is", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(400),
    // Returns [] for designers (RLS: admins only)
    sb.from("task_requests").select("*").order("created_at", { ascending: false }),
    fetchAll<DbRow>(sb, "dev_items", "*").catch(() => [] as DbRow[]),
  ]);

  // These two used to swallow their errors via `?? []`. On a background refresh
  // that would replace the feed (or the intake queue) with an empty list and call
  // it success, so they now throw. task_requests legitimately returns [] WITHOUT
  // an error for designers, which is why only a real error is a failure here.
  if (feed.error) throw new Error(`time_entries feed: ${feed.error.message}`);
  if (requests.error) throw new Error(`task_requests: ${requests.error.message}`);

  return {
    tasks: taskRows.map((r) => mapTask({ ...r, brief: undefined }, ctx.tagNames, ctx.projectClient)),
    planEntries: pe.map(mapPlanEntry),
    timeEntries: ((feed.data ?? []) as DbRow[]).map(mapTimeEntry),
    entrySums: sums.map(mapEntrySum),
    taskRequests: (requests.data ?? []) as DbRow[],
    devItems: dev.map(mapDevItem).sort((a: DevItem, b: DevItem) => a.position - b.position),
  };
}

export async function fetchFull(sb: Sb): Promise<ColdSnapshot & HotSnapshot> {
  const cold = await fetchCold(sb);
  const hot = await fetchHot(sb, {
    tagNames: new Map(cold.tags.map((t) => [t.id, t.name])),
    projectClient: cold.projectClient,
  });
  return { ...cold, ...hot };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Cheap "did anything change?" for a hot snapshot. Not cryptographic and
 * deliberately partial: it only has to differ when somebody ELSE changed
 * something an undo step could target. There is no `updated_at` anywhere in this
 * schema, so the server can't answer the question and the client has to.
 *
 * Time entries contribute their count and total only — there are tens of
 * thousands of them and this runs on every tick.
 */
export function fingerprint(h: HotSnapshot): string {
  const tasks = h.tasks
    .map(
      (t) =>
        `${t.id}${t.title}${t.status}${t.assigneeId}${t.sectionId}${t.clientId}${t.dueDate}${t.estimateHours}${t.position}${t.billable}${t.tag}`,
    )
    .join("");
  const plan = h.planEntries
    .map((e) => `${e.id}${e.date}${e.columnId}${e.position}${e.text}${e.taskId}${e.absenceType}`)
    .join("");
  const minutes = h.entrySums.reduce((a, e) => a + e.minutes, 0);
  return [
    hash(tasks),
    hash(plan),
    h.entrySums.length,
    minutes,
    h.devItems.length,
    h.taskRequests.length,
  ].join(":");
}

/**
 * Fresh tasks win, but keep any lazily loaded `brief` — the snapshot query
 * deliberately doesn't select it (it's per-task detail), so a plain replace
 * would blank the brief of whatever task is open.
 */
export function mergeTasks(fresh: Task[], prev: Task[]): Task[] {
  const briefs = new Map(prev.filter((t) => t.brief).map((t) => [t.id, t.brief]));
  return fresh.map((t) => (t.brief ? t : { ...t, brief: briefs.get(t.id) ?? "" }));
}

/**
 * The feed window is the newest 400 rows, but `openTask` also loads every entry
 * for one task — those older rows live in the same list and must survive a
 * refresh. `entrySums` is the whole table, so it's the authority on what still
 * exists: an out-of-window row missing from it was deleted elsewhere.
 */
export function mergeTimeEntries(
  fresh: TimeEntry[],
  freshSums: EntrySum[],
  prev: TimeEntry[],
): TimeEntry[] {
  const inWindow = new Set(fresh.map((e) => e.id));
  const live = new Set(freshSums.map((e) => e.id));
  return [...fresh, ...prev.filter((e) => !inWindow.has(e.id) && live.has(e.id))];
}
