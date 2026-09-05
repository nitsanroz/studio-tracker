"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "../supabase/client";
import {
  isServiceBlocked,
  mapComment,
  mapTimeEntry,
  type DbRow,
} from "../db";
import {
  fetchCold,
  fetchFull,
  fetchHot,
  fetchTasks,
  fingerprint,
  mergeTasks,
  mergeTimeEntries,
  idleTransition,
  pollDecision,
  historyEpochShouldMove,
  refreshVerdict,
  wakeTransition,
  type ColdSnapshot,
  type HotCtx,
  type HotSnapshot,
} from "../snapshot";
import type {
  Attachment,
  BillingPeriod,
  Client,
  DayState,
  DevItem,
  EntrySum,
  UserEntrySum,
  Link,
  PlanColumn,
  PlanEntry,
  Profile,
  Section,
  Tag,
  Task,
  TaskComment,
  TaskGroup,
  TaskType,
  TimeEntry,
  TimelineMark,
} from "../types";

import {
  type HistoryAction,
  type Store,
  type TaskRequest,
} from "./types";
import {
  COLD_AFTER_AWAY_MS,
  COLD_EVERY_N_TICKS,
  FOCUS_MAX_STALE_MS,
  FOCUS_MIN_GAP_MS,
  HOT_INTERVAL_MS,
  IDLE_AFTER_MS,
  TASKS_EVERY_N_TICKS,
  WRITE_SETTLE_MS,
} from "./refresh-cadence";
import { mapTaskRequest, withGroupInvariant } from "./helpers";
import { usePlanActions } from "./plan";
import { useClientActions } from "./clients";
import { useTaxonomyActions } from "./taxonomy";
import { useCommentActions } from "./comments";
import { useRequestActions } from "./requests";
import { useKeysWriteDown } from "./keys-write-down";
import { useTimeEntryActions } from "./time-entries";
import { useBillingActions } from "./billing";
import { useDevItemActions } from "./dev-items";
import { useTimelineActions } from "./timeline";
import { useLinkActions } from "./links";
import { useTaskActions } from "./tasks";
import { guardPreview } from "./preview-guard";

/** Re-exported so `@/lib/store` keeps the surface it has always had. */
export { withGroupInvariant };
export type { TaskRequest };

const StoreContext = createContext<Store | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [dayStates, setDayStates] = useState<DayState[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [timelineMarks, setTimelineMarks] = useState<TimelineMark[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  /** tasks whose lazily-fetched `brief` has actually arrived — see loadTaskExtras */
  const [briefLoaded, setBriefLoaded] = useState<Set<string>>(new Set());
  const [devItems, setDevItems] = useState<DevItem[]>([]);
  const [tagRows, setTagRows] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [entrySumsAll, setEntrySums] = useState<EntrySum[]>([]);
  /**
   * The same list, readable synchronously. `applyHot` needs it (see there) and
   * runs before any state it queued has committed, so state alone can't answer.
   * Kept honest against local mutations by the mirroring effect below.
   */
  const entrySumsRef = useRef<EntrySum[]>([]);
  /**
   * The last task list the SERVER sent, for `fingerprint` only — never for
   * rendering, and deliberately not mirrored from `tasks` state: local
   * optimistic edits must not read as a colleague's change and expire the undo
   * history. Written by applyTasks, i.e. only when a fetch actually landed.
   */
  const serverTasksRef = useRef<Task[]>([]);
  const [planColumns, setPlanColumns] = useState<PlanColumn[]>([]);
  const [planEntries, setPlanEntries] = useState<PlanEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  // ── admin "view as" preview: ?viewAs=<name|id> renders the UI as that member ──
  const [viewAsKey, setViewAsKey] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("viewAs");
    if (fromUrl === "off") {
      localStorage.removeItem("viewAs");
      setViewAsKey(null);
      return;
    }
    if (fromUrl) localStorage.setItem("viewAs", fromUrl);
    setViewAsKey(fromUrl ?? localStorage.getItem("viewAs"));
  }, []);
  const viewAsProfile = useMemo(() => {
    if (!viewAsKey) return null;
    // only real admins may preview, and never as themselves
    if (profiles.find((p) => p.id === currentUserId)?.role !== "admin") return null;
    const key = viewAsKey.toLowerCase();
    const target = profiles.find(
      (p) => p.id === viewAsKey || p.name.toLowerCase().startsWith(key),
    );
    return target && target.id !== currentUserId ? target : null;
  }, [viewAsKey, currentUserId, profiles]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [taskRequests, setTaskRequests] = useState<TaskRequest[]>([]);
  const loadedTaskExtras = useRef<Set<string>>(new Set());

  // ── write-failure surfacing ─────────────────────────────────────────────
  // Optimistic writes used to fail silently (state diverged from the DB until a
  // reload). Every mutation now routes its error through noteWriteError, which
  // logs and raises a user-visible banner (rendered in app-shell) offering a
  // reload to resync with the server.
  const [writeError, setWriteError] = useState<string | null>(null);
  const dismissWriteError = useCallback(() => setWriteError(null), []);
  /**
   * Set when a fetch comes back 402, cleared by the next refresh that succeeds —
   * so it is self-healing and cannot linger after the bill is paid. Deliberately
   * NOT dismissible: an open tab showing stale figures is exactly the failure
   * this exists to make visible, and a dismissed banner would restore it.
   */
  const [serviceBlocked, setServiceBlocked] = useState(false);
  /** Boot query failed outright — the app has no data, and must say so. */
  const [bootError, setBootError] = useState<string | null>(null);
  const noteWriteError = useCallback((label: string, error: { message: string }) => {
    console.error(`${label} failed`, error.message);
    setWriteError("Some changes couldn't be saved. Reload to get the latest from the server.");
  }, []);

  // ── background refresh plumbing ───────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [freshEntryId, setFreshEntryId] = useState<string | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ⚠️ One timer, replaced — logging twice quickly must not leave the first row
   *  lit while the second is still animating. */
  const markFresh = useCallback((id: string) => {
    if (freshTimer.current) clearTimeout(freshTimer.current);
    setFreshEntryId(id);
    freshTimer.current = setTimeout(() => setFreshEntryId(null), 600);
  }, []);
  const showNotice = useCallback((text: string) => setNotice(text), []);
  /** Bumped by boot AND every refresh, so a slow response can tell it's stale. */
  const generation = useRef(0);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const fingerprintRef = useRef<string | null>(null);
  /**
   * `writeSeq` as it stood when `fingerprintRef` was last set.
   *
   * ⚠️ WITHOUT THIS, A USER'S OWN EDIT EXPIRED THEIR OWN UNDO HISTORY. The print
   * is computed from the SERVER response, so once a local write comes back it
   * differs from the stored print — `changed` went true, the epoch was bumped,
   * and the next ⌘Z wiped the history claiming "Someone else changed the studio
   * data since then" when nobody had. Every mutation reaches the print one way
   * or another, so undo was usable only until the first tick that observed your
   * own change.
   */
  const printWriteSeqRef = useRef(0);
  const lastSyncedRef = useRef<number | null>(null);
  const refreshRef = useRef<
    ((opts?: { cold?: boolean; tasks?: boolean; reason?: string }) => void) | null
  >(null);
  /** What `fetchHot` needs from the cold half; kept in a ref so refresh() is stable. */
  const coldCtxRef = useRef<HotCtx>({ tagNames: new Map(), projectClient: new Map() });
  const openTaskIdRef = useRef<string | null>(null);
  /**
   * Last pointer/key/scroll/focus in this tab — drives IDLE_AFTER_MS. Seeded
   * when the polling effect arms rather than here: `Date.now()` during render is
   * impure, and boot is the honest start of the idle clock anyway — a slow boot
   * shouldn't spend the user's first minutes of grace before the app is usable.
   */
  const lastActivityRef = useRef(0);
  /** Whether polling is currently paused, as a ref so the interval can read it. */
  const idleRef = useRef(false);
  /**
   * The same flag as state, so the sync dot can say so. Set ONLY on the two
   * transitions, never per tick or per mouse move — this must not re-render the
   * whole app on pointermove.
   */
  const [pollingPaused, setPollingPaused] = useState(false);

  // In-flight optimistic writes. A refresh must not land between the local
  // setState and the server commit, or the user's own edit flickers backwards.
  const writes = useRef(0);
  const lastWriteAt = useRef(0);
  /**
   * Monotonic count of writes ISSUED — it never goes down, unlike `writes`.
   *
   * ⚠️ This is what closes the "my edit jumped back" race, and the reason the
   * `writes` counter alone can't: a refresh that was ALREADY IN FLIGHT when the
   * user edited something returns a snapshot read BEFORE that edit, and by the
   * time it lands the write may well have settled — so every "is a write in
   * flight?" test at apply time says no, and the pre-edit row is applied over
   * the user's own change. Capturing this before the fetch and comparing after
   * is the only way to see that the response is older than what's on screen.
   */
  const writeSeq = useRef(0);
  /** A rejected promise could leak the counter, so it also expires. */
  const writesBusy = useCallback(
    () => writes.current > 0 && Date.now() - lastWriteAt.current < WRITE_SETTLE_MS,
    [],
  );
  /** Cheap global "the user is mid-edit" test — no per-field registry needed. */
  const focusInEditor = useCallback(() => {
    const el = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    return (
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable)
    );
  }, []);
  /**
   * The tail every optimistic update/delete ends with. Counts the write as in
   * flight so a refresh defers, surfaces failures exactly as before, and runs a
   * deferred refresh once the write settles.
   *
   * Inserts use `counting` instead — same bookkeeping, different callback shape.
   */
  const wrote = useCallback(
    (label: string) => {
      writes.current++;
      writeSeq.current++;
      lastWriteAt.current = Date.now();
      return ({ error }: { error: { message: string } | null }) => {
        writes.current = Math.max(0, writes.current - 1);
        lastWriteAt.current = Date.now();
        if (error) noteWriteError(label, error);
        else if (refreshQueued.current && writes.current === 0) {
          refreshQueued.current = false;
          void refreshRef.current?.({ reason: "after-write" });
        }
      };
    },
    [noteWriteError],
  );

  /**
   * The same in-flight bookkeeping as `wrote`, for an INSERT — wrapped around
   * the built query rather than attached to its callback, because an insert
   * appends its row IN the callback and every call site reads `data` there.
   * Usage is one line: `counting(sb.from(x).insert(…).select().single()).then(…)`.
   *
   * ⚠️ INSERTS USED TO DO NONE OF THIS, on the reasoning that "a new row can't
   * be clobbered — if the refresh lands first the row isn't in the snapshot yet
   * and the callback appends it; if it lands after, the row is already there."
   * That covers two orderings out of three. A refresh ISSUED BEFORE the insert
   * and LANDING AFTER the callback carries a list that predates the row, and
   * every apply path REPLACES wholesale (`setLinks(c.links)`, `setPlanEntries`,
   * `setClients`, …) — so the row is dropped from the screen while sitting
   * perfectly safely in the database, until the next cold refresh happens to
   * bring it back. Reported 20 Aug 2026 as "I added a link and my colleague
   * couldn't see it"; a return to a backgrounded tab fires a cold refresh, and
   * the thing you came back to do is the thing that gets erased.
   *
   * Counting the insert in `writeSeq` is what lets `refreshVerdict` call that
   * response what it is: older than the screen. It is the exact race the ⚠️ note
   * on `refreshVerdict` describes for updates — "a background refresh is a READ
   * THAT WAS ISSUED IN THE PAST" — and inserts were simply exempted from it.
   *
   * The queued refresh runs on settle either way: on success it brings the row
   * plus whatever else changed, and on failure it brings server truth, which is
   * what a caller that just failed to write most needs.
   */
  const counting = useCallback(<T,>(query: PromiseLike<T>): Promise<T> => {
    writes.current++;
    writeSeq.current++;
    lastWriteAt.current = Date.now();
    const settle = () => {
      writes.current = Math.max(0, writes.current - 1);
      lastWriteAt.current = Date.now();
      if (refreshQueued.current && writes.current === 0) {
        refreshQueued.current = false;
        void refreshRef.current?.({ reason: "after-insert" });
      }
    };
    return Promise.resolve(query).then(
      (v) => {
        settle();
        return v;
      },
      (e) => {
        settle();
        throw e;
      },
    );
  }, []);

  // ── undo / redo history (last 10 data actions) ────────────────────────
  const historyRef = useRef<{ past: HistoryAction[]; future: HistoryAction[] }>({ past: [], future: [] });
  const suppressHistory = useRef(false);
  /** Bumped whenever a background refresh brings in someone else's change. */
  const epoch = useRef(0);
  /** Latest mutation methods, so history actions never call stale closures. */
  const methodsRef = useRef<Store | null>(null);
  const record = useCallback((action: Omit<HistoryAction, "epoch">) => {
    if (suppressHistory.current) return;
    historyRef.current.past.push({ ...action, epoch: epoch.current });
    if (historyRef.current.past.length > 10) historyRef.current.past.shift();
    historyRef.current.future = [];
  }, []);
  /**
   * True when the step is older than the last change a refresh brought in. Undoing
   * it would write a value captured before that change, quietly reverting whoever
   * made it — so the whole history goes instead (everything older is equally stale).
   */
  const expired = useCallback((action: HistoryAction) => {
    if (action.epoch === epoch.current) return false;
    historyRef.current.past.length = 0;
    historyRef.current.future.length = 0;
    setNotice("Someone else changed the studio data since then, so that undo is no longer available.");
    return true;
  }, []);
  const undo = useCallback(() => {
    const action = historyRef.current.past.pop();
    if (!action) return;
    if (expired(action)) return;
    suppressHistory.current = true;
    try {
      action.undo();
    } finally {
      suppressHistory.current = false;
    }
    historyRef.current.future.push(action);
  }, [expired]);
  const redo = useCallback(() => {
    const action = historyRef.current.future.pop();
    if (!action) return;
    if (expired(action)) return;
    suppressHistory.current = true;
    try {
      action.redo();
    } finally {
      suppressHistory.current = false;
    }
    historyRef.current.past.push(action);
  }, [expired]);
  /**
   * Record ONE undo step for a gesture that calls several mutations — a
   * cross-column plan drag both moves the entry and reassigns the task, and
   * should take one ⌘Z, not two.
   *
   * `record` runs first so an outer undo/redo still suppresses it, and the inner
   * suppression saves and RESTORES the flag rather than clearing it: `redo()`
   * already holds it, and a bare `= false` would release it half-way through.
   */
  const asOneStep = useCallback(
    (action: Omit<HistoryAction, "epoch">, apply: () => void) => {
      record(action);
      const outer = suppressHistory.current;
      suppressHistory.current = true;
      try {
        apply();
      } finally {
        suppressHistory.current = outer;
      }
    },
    [record],
  );

  // cmd/ctrl+Z → undo, +shift → redo; text fields keep the browser's native undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const tagNameById = useMemo(() => new Map(tagRows.map((t) => [t.id, t.name])), [tagRows]);
  const tagIdByName = useMemo(() => new Map(tagRows.map((t) => [t.name, t.id])), [tagRows]);

  /**
   * The DEFAULT deliberately EXCLUDES pre-Everhour backfill (`legacy`). Those
   * entries are attributed to people who still work here, so leaking them into a
   * personal or time-series surface would invent 2021 working days for someone
   * today — and the failure would be silent. Excluding by default means a surface
   * nobody remembered to audit degrades safely; the client-facing totals that
   * genuinely want the history opt in via `entrySumsAll`.
   */
  // The type narrowing is load-bearing, not cosmetic: dropping the legacy rows is
  // exactly what guarantees a real user_id (0017 only allows null on those), so
  // every downstream per-member aggregation indexes by userId without a guard.
  const entrySums = useMemo(
    () => entrySumsAll.filter((e): e is UserEntrySum => !e.legacy && e.userId != null),
    [entrySumsAll],
  );

  // Local optimistic edits (log, edit, delete an entry; delete a task) write
  // straight to state, so the ref has to follow them too — otherwise the next
  // hot tick would merge the feed against a set that still describes the DB as
  // it was before the user's own change.
  useEffect(() => {
    entrySumsRef.current = entrySumsAll;
  }, [entrySumsAll]);

  // Task totals include the recovered history — that IS the task's real cost.
  const minutesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entrySumsAll) map.set(e.taskId, (map.get(e.taskId) ?? 0) + e.minutes);
    return map;
  }, [entrySumsAll]);

  // ── initial load ──────────────────────────────────────────────────────
  const applyCold = useCallback((c: ColdSnapshot) => {
    setProfiles(c.profiles);
    setEntrySums(c.entrySums);
    // applyHot reads this synchronously (see below), so it must be written here
    // rather than derived from the state update, which hasn't committed yet.
    entrySumsRef.current = c.entrySums;
    setClients(c.clients);
    setSections(c.sections);
    setTaskGroups(c.taskGroups);
    setTagRows(c.tags);
    setPlanColumns(c.planColumns);
    setBillingPeriods(c.billingPeriods);
    setDayStates(c.dayStates);
    setLinks(c.links);
    setTimelineMarks(c.timelineMarks);
    setTaskTypes(c.taskTypes);
    // a hot-only refresh maps its tasks with these, so they must follow the cold half
    coldCtxRef.current = {
      tagNames: new Map(c.tags.map((t) => [t.id, t.name])),
      projectClient: c.projectClient,
    };
  }, []);

  /**
   * Tasks arrive on their own tier now (TASKS_EVERY_N_TICKS), so this runs on
   * roughly one tick in three — and on every boot, manual refresh and
   * return-from-away, which all go through the cold path.
   *
   * ⚠️ The rows are the COMPLETE task list every time, exactly as before, which
   * is what makes this safe: `mergeTasks` replaces wholesale, so a partial
   * fetch would make tasks disappear from every screen in the app.
   */
  const applyTasks = useCallback((fresh: Task[]) => {
    setTasks((prev) => mergeTasks(fresh, prev));
    // The un-merged server rows, for `fingerprint`. mergeTasks only re-attaches
    // the lazily-loaded `brief`, which the print doesn't hash — so this is the
    // same comparison the print made when tasks were fetched every tick, and it
    // deliberately does NOT track local optimistic edits.
    serverTasksRef.current = fresh;
  }, []);

  const applyHot = useCallback((h: HotSnapshot) => {
    // ⚠️ The sums come from the last COLD fetch, not from `h` — they left the hot
    // tier so the app would stop pulling the whole `time_entries` table every
    // 60s. They are only consulted to decide which OUT-OF-WINDOW rows still
    // exist, and a stale set errs toward keeping a row, so up-to-10-minute-old
    // sums are safe here. Read from the ref, not from state: applyCold and
    // applyHot run in the same commit on boot and on a cold tick.
    setTimeEntries((prev) => mergeTimeEntries(h.timeEntries, entrySumsRef.current, prev));
    setPlanEntries(h.planEntries);
    setTaskRequests(h.taskRequests.map(mapTaskRequest));
    setDevItems(h.devItems);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        window.location.href = "/login";
        return;
      }
      const snap = await fetchFull(supabase);
      if (cancelled) return;
      generation.current++;
      setCurrentUserId(uid);
      applyCold(snap);
      applyTasks(snap.tasks);
      applyHot(snap);
      fingerprintRef.current = fingerprint(snap, {
        tasks: snap.tasks,
        entrySums: snap.entrySums,
      });
      // Baseline the write counter with the print it belongs to — see the ⚠️ on
      // `printWriteSeqRef`. Boot is the one place both are set from scratch.
      printWriteSeqRef.current = writeSeq.current;
      lastSyncedRef.current = Date.now();
      setLoading(false);
    })().catch((e) => {
      console.error("store load failed", e);
      if (cancelled) return;
      // Without this the app renders as if the studio simply had no tasks,
      // clients or hours — an empty state is a claim about the data, and this
      // isn't one we can make. Surface it and offer a reload instead.
      // Boot can't show a banner — there is no app yet — so the error screen has
      // to say the true thing. Its default copy blames a dropped connection,
      // which for a 402 would send someone to check their wifi for an hour.
      if (isServiceBlocked(e)) setServiceBlocked(true);
      setBootError(
        e instanceof Error && e.message ? e.message : "The studio data couldn't be loaded.",
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, applyCold, applyTasks, applyHot]);

  // ── lazy per-task detail (brief, comments, full entries) ─────────────
  /**
   * Each merge REPLACES this task's rows rather than appending unseen ones.
   * Append-dedup could never reflect a deleted or edited comment, which is
   * exactly what a background refresh needs to be able to do. Safe because each
   * query is `eq("task_id")` — a strict superset of what the list already holds
   * for that task.
   */
  const loadTaskExtras = useCallback(
    async (taskId: string, opts: { refetch?: boolean } = {}) => {
      // Same race as `refresh`, on the surface that's edited most: a background
      // re-fetch of the open task's comments and hours can land after the user
      // has logged or edited one, replacing their row with the pre-edit set.
      // Only a REFETCH may bail — the first open has nothing to fall back on,
      // so bailing there would leave the pane permanently empty.
      const seenWrites = writeSeq.current;
      const stale = () => opts.refetch && writeSeq.current !== seenWrites;
      const [detail, cm, entries, atts] = await Promise.all([
        supabase.from("tasks").select("id, brief").eq("id", taskId).single(),
        supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
        supabase
          .from("time_entries")
          .select("*")
          .eq("task_id", taskId)
          .not("minutes", "is", null)
          .order("date", { ascending: false }),
        supabase.from("attachments").select("*").eq("task_id", taskId).order("created_at"),
      ]);
      if (stale()) return;
      if (atts.data) {
        const mapped = (atts.data as DbRow[]).map((a) => ({
          id: a.id as string,
          taskId: a.task_id as string,
          fileName: a.file_name as string,
          filePath: a.file_path as string,
          sizeBytes: a.size_bytes as number,
          uploadedBy: a.uploaded_by as string,
        }));
        setAttachments((prev) => [...prev.filter((a) => a.taskId !== taskId), ...mapped]);
      }
      if (detail.data) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, brief: detail.data.brief ?? "" } : t)),
        );
        // The brief editor MUST NOT open before this lands. Until it does,
        // `task.brief` is "" for every task in the list — not because the task
        // has no brief, but because the snapshot query doesn't fetch the column.
        // Saving from that state would write an empty string over real text.
        // Monotonic on purpose: a later refresh re-runs this fetch, and
        // `mergeTasks` keeps the brief in the meantime, so it never un-loads.
        setBriefLoaded((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)));
      }
      if (cm.data) {
        const mapped = (cm.data as DbRow[]).map(mapComment);
        setComments((prev) => [...prev.filter((c) => c.taskId !== taskId), ...mapped]);
      }
      if (entries.data) {
        const mapped = (entries.data as DbRow[]).map(mapTimeEntry);
        setTimeEntries((prev) => [...prev.filter((e) => e.taskId !== taskId), ...mapped]);
      }
    },
    [supabase],
  );

  const isBriefLoaded = useCallback((taskId: string) => briefLoaded.has(taskId), [briefLoaded]);

  const openTask = useCallback(
    (taskId: string | null) => {
      setOpenTaskId(taskId);
      openTaskIdRef.current = taskId;
      if (!taskId || loadedTaskExtras.current.has(taskId)) return;
      loadedTaskExtras.current.add(taskId);
      loadTaskExtras(taskId).catch((e) => console.error("task detail load failed", e));
    },
    [loadTaskExtras],
  );

  // ── background refresh ────────────────────────────────────────────────
  // Polling, deliberately: no websockets and nothing to enable in Supabase.
  //
  // Three things this must NEVER do, each of which would be worse than stale data:
  //  · touch `loading` or `bootError` — either would throw the full-screen splash
  //    or the error page over a working app on every tick
  //  · run getUser()/redirect-to-login — a transient auth hiccup would navigate
  //    someone away mid-edit
  //  · land while an optimistic write is in flight — it would overwrite the
  //    user's own edit with the pre-edit server row
  const refresh = useCallback(
    async (opts: { cold?: boolean; tasks?: boolean; reason?: string } = {}) => {
      if (refreshInFlight.current) return;
      /**
       * Defer rather than clobber: a fresh snapshot landing between an optimistic
       * setState and its server commit would flicker the edit backwards. The
       * write tail re-runs this, and the next tick retries anyway.
       *
       * ⚠️ THE FOCUS HALF IS BOUNDED, BECAUSE IT USED TO BE ABLE TO STOP THE APP
       * REFRESHING FOR EVER. `refreshQueued` is drained only when a WRITE settles
       * (see `wrote`/`counting`), and a focus-only deferral has no write to settle
       * — so a cursor left in a field suppressed every tick indefinitely, with no
       * upper bound and nothing on screen saying so. Clicking the header search
       * box and walking away was enough: tasks, the plan, the feed and the hours
       * all frozen at that moment, a colleague's edits never arriving, and the
       * only trace the sync dot's "Updated …" quietly ceasing to advance — the
       * same invisible staleness v1.19.12 built a banner for.
       *
       * So focus may hold a refresh off, but only while the data on screen is
       * still fresh. Past `FOCUS_MAX_STALE_MS` the refresh goes ahead: stale data
       * nobody is warned about is the worse failure. The race the focus test was
       * guarding against is covered either way — `refreshVerdict` compares
       * `writeSeq` from before the fetch against now, so an edit made while the
       * fetch was out still defers the response.
       */
      const staleFor = Date.now() - (lastSyncedRef.current ?? 0);
      const focusBlocking = focusInEditor() && staleFor < FOCUS_MAX_STALE_MS;
      if (writesBusy() || focusBlocking) {
        refreshQueued.current = true;
        return;
      }
      refreshInFlight.current = true;
      const mine = ++generation.current;
      // Read BEFORE the fetch goes out, compared after it lands — see `writeSeq`.
      const seenWrites = writeSeq.current;
      setRefreshing(true);
      try {
        const cold = opts.cold ? await fetchCold(supabase) : null;
        // A cold refresh (boot, manual, back after 5+ minutes away) always takes
        // the tasks too — those are the moments someone is asking for the truth.
        const wantTasks = opts.tasks || opts.cold;
        const [freshTasks, hot] = await Promise.all([
          wantTasks
            ? fetchTasks(supabase, {
                tagNames: coldCtxRef.current.tagNames,
                projectClient: coldCtxRef.current.projectClient,
              })
            : null,
          fetchHot(supabase),
        ]);
        // Is this response still younger than what's on screen? See `refreshVerdict`
        // — the start-of-refresh guards can't speak for the time the fetch was out.
        const verdict = refreshVerdict({
          mine,
          generation: generation.current,
          seenWrites,
          writeSeq: writeSeq.current,
          // The same bounded rule as the pre-fetch guard — re-read here because
          // focus can have moved while the fetch was out. Unbounded, this branch
          // would drop the response of the very refresh the cap just allowed.
          focused: focusInEditor() && Date.now() - (lastSyncedRef.current ?? 0) < FOCUS_MAX_STALE_MS,
        });
        if (verdict === "stale") return;
        if (verdict === "deferred") {
          refreshQueued.current = true;
          return;
        }
        // An empty studio is never a real refresh result: it means the session
        // expired and RLS returned nothing. Applying it would blank the app.
        //
        // ⚠️ `tasks` used to be the canary and no longer arrives on every tick,
        // so two ticks in three need a different one. The 400-row feed AND the
        // plan being simultaneously empty cannot happen in a studio with ten
        // years of history — but either alone can (a quiet planning week), which
        // is why this is an AND.
        const blank = freshTasks
          ? freshTasks.length === 0
          : hot.timeEntries.length === 0 && hot.planEntries.length === 0;
        if (blank || (cold && cold.profiles.length === 0)) {
          throw new Error("refresh returned an empty studio — treating as auth, not data");
        }
        // This response satisfied whatever earlier one was deferred, so the flag
        // mustn't survive to fire a spurious refresh off the next unrelated write.
        refreshQueued.current = false;
        if (cold) applyCold(cold);
        if (freshTasks) applyTasks(freshTasks);
        applyHot(hot);

        // Whatever wasn't refetched on this tick is passed through unchanged, so
        // its half of the print holds still rather than reading as somebody
        // else's edit. Both values are the last SERVER response, never local
        // state — see fingerprint. applyCold/applyTasks have already updated
        // their refs by here when this tick fetched them.
        const next = fingerprint(hot, {
          tasks: serverTasksRef.current,
          entrySums: entrySumsRef.current,
        });
        const changed = fingerprintRef.current !== null && next !== fingerprintRef.current;
        /**
         * Did WE write anything since this print was taken? If not, a difference
         * can only be somebody else's edit and every undo step is now built on
         * stale values, so the epoch moves and `expired` retires them.
         *
         * ⚠️ If we did write, the difference is explained by our own change and
         * must NOT retire our own history — that was the bug. The print is still
         * re-baselined, so the next quiet tick compares against current truth.
         *
         * ⚠️ RESIDUAL, stated because it is a real trade and not a fix: if a
         * colleague's change lands in the SAME tick as one of ours, this cannot
         * tell the two apart and the epoch stays put, so an undo of our step is
         * still offered and could revert theirs. Narrow (one tick, both writing)
         * and strictly better than the alternative, which was the guard firing
         * on every single edit and so protecting nothing while breaking undo.
         */
        const wroteSincePrint = writeSeq.current !== printWriteSeqRef.current;
        fingerprintRef.current = next;
        printWriteSeqRef.current = writeSeq.current;
        if (historyEpochShouldMove({ printChanged: changed, wroteSincePrint })) epoch.current++;
        lastSyncedRef.current = Date.now();
        setLastSyncedAt(Date.now());
        // Whatever was wrong has cleared, so retract the banner.
        setServiceBlocked(false);

        // The open task's comments/attachments are lazily loaded and were being
        // memoised forever, so the most collaborative surface in the app was the
        // one place a refresh couldn't reach.
        loadedTaskExtras.current.clear();
        const open = openTaskIdRef.current;
        if (open) {
          loadedTaskExtras.current.add(open);
          void loadTaskExtras(open, { refetch: true });
        }
        if (changed) console.debug("[refresh]", opts.reason ?? "", { cold: !!cold, changed });
      } catch (e) {
        // Soft failure by design: keep the data we have, say nothing to the user.
        // A background tick failing is not something they can act on.
        //
        // ⚠️ The ONE exception: a 402 means Supabase has cut the project off over
        // its usage quota. That is persistent, actionable, and otherwise silent —
        // this tab would go on showing stale figures indefinitely, and the next
        // person to notice would be a client opening a broken report link.
        if (isServiceBlocked(e)) setServiceBlocked(true);
        console.warn("[refresh] failed", e);
      } finally {
        refreshInFlight.current = false;
        setRefreshing(false);
      }
    },
    [supabase, applyCold, applyTasks, applyHot, loadTaskExtras, writesBusy, focusInEditor],
  );
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  /** Void-returning wrapper for the context (callers don't await a refresh). */
  const refreshNow = useCallback(() => {
    void refresh({ cold: true, reason: "manual" });
  }, [refresh]);

  useEffect(() => {
    if (loading || bootError) return; // boot owns the first load
    lastActivityRef.current = Date.now(); // the app just became usable
    let ticks = 0;

    /**
     * Bring the screen up to date after a gap. Shared by tab-focus and by waking
     * from idle, because they are the same event as far as the data goes: time
     * passed without fetching, and the user is now looking.
     */
    const catchUp = (reason: string) => {
      if (document.hidden) return;
      const since = Date.now() - (lastSyncedRef.current ?? 0);
      // macOS fires focus on every window switch; don't refetch for an alt-tab
      if (since < FOCUS_MIN_GAP_MS) return;
      void refreshRef.current?.({ cold: since > COLD_AFTER_AWAY_MS, reason });
    };

    /** Leave the idle state, if we were in it, and catch up. */
    const wake = (reason: string) => {
      const t = wakeTransition(idleRef.current);
      if (!t.catchUp) return false;
      idleRef.current = t.paused;
      setPollingPaused(t.paused);
      console.debug("[poll] resumed —", reason);
      catchUp(reason);
      return true;
    };

    /**
     * ⚠️ Hot path: this runs on every pointermove. It must stay a timestamp
     * write plus one boolean read — no setState, no work — or the app re-renders
     * continuously while the mouse moves.
     */
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      wake("woke");
    };

    const id = setInterval(() => {
      const decision = pollDecision({
        hidden: document.hidden,
        msSinceActivity: Date.now() - lastActivityRef.current,
        idleAfterMs: IDLE_AFTER_MS,
      });
      // Announce the pause once, so the sync dot can stop claiming to be live.
      // `hidden` deliberately does NOT set this: nobody is looking at a
      // background tab, and it resumes the moment they come back to it.
      const t = idleTransition(idleRef.current, decision);
      if (t.announce) {
        console.debug("[poll] paused — untouched for", Math.round(IDLE_AFTER_MS / 1000), "s");
      }
      if (t.paused !== idleRef.current) {
        idleRef.current = t.paused;
        setPollingPaused(t.paused);
      }
      if (decision !== "poll") return;
      ticks++;
      void refreshRef.current?.({
        cold: ticks % COLD_EVERY_N_TICKS === 0,
        tasks: ticks % TASKS_EVERY_N_TICKS === 0,
        reason: "interval",
      });
    }, HOT_INTERVAL_MS);

    const onFocus = () => {
      lastActivityRef.current = Date.now();
      // Coming back to the tab is activity AND a focus event; `wake` catches up
      // when we were idle, and this covers the ordinary case when we weren't.
      if (!wake("woke")) catchUp("focus");
    };

    // capture + passive: some components stopPropagation, and none of these
    // handlers ever calls preventDefault.
    const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
    for (const e of ACTIVITY) {
      document.addEventListener(e, onActivity, { passive: true, capture: true });
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      for (const e of ACTIVITY) {
        document.removeEventListener(e, onActivity, { capture: true });
      }
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loading, bootError]);

  // ── tasks, sections & task groups ─────────────────────────────────────
  // Lifted into ./tasks.ts — see ./plan.ts for why deps arrive as an object.
  const taskActions = useTaskActions({
    supabase,
    tasks,
    setTasks,
    sections,
    setSections,
    taskGroups,
    setTaskGroups,
    clients,
    tagIdByName,
    tagNameById,
    setTimeEntries,
    setEntrySums,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });

  // ── tags & task types ─────────────────────────────────────────
  // Lifted into ./taxonomy.ts — see ./plan.ts for why deps arrive as an object.
  const taxonomy = useTaxonomyActions({
    supabase,
    tagRows,
    setTagRows,
    taskTypes,
    setTaskTypes,
    setTasks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });

  // ── clients & member profiles ─────────────────────────────────────────
  // Lifted into ./clients.ts — see ./plan.ts for why deps arrive as an object.
  const clientActions = useClientActions({
    supabase,
    clients,
    setClients,
    profiles,
    setProfiles,
    setTasks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
    tagNameById,
    setNotice,
  });


  // ── weekly plan ───────────────────────────────────────────────────────
  // Lifted into ./plan.ts — see the note at the top of that file for why the
  // deps arrive as an object and the result is memoized.
  const plan = usePlanActions({
    supabase,
    planEntries,
    planColumns,
    tasks,
    setPlanEntries,
    setPlanColumns,
    record,
    wrote,
    noteWriteError,
    methodsRef,
    counting,
    asOneStep,
  });
  // ── task comments & attachments ─────────────────────────────────────────
  // Lifted into ./comments.ts — see ./plan.ts for why deps arrive as an object.
  const commentActions = useCommentActions({
    supabase,
    comments,
    setComments,
    setAttachments,
    currentUserId,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });

  // ── time entries ─────────────────────────────────────────
  // Lifted into ./time-entries.ts — see ./plan.ts for why deps arrive as an object.
  const entries = useTimeEntryActions({
    supabase,
    timeEntries,
    setTimeEntries,
    entrySumsAll,
    setEntrySums,
    currentUserId,
    markFresh,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });


  // ── billing periods & studio days off ─────────────────────────────────────────
  // Lifted into ./billing.ts — see ./plan.ts for why deps arrive as an object.
  const billing = useBillingActions({
    supabase,
    billingPeriods,
    setBillingPeriods,
    setDayStates,
    currentUserId,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });

  // ── in-development list ─────────────────────────────────────────
  // Lifted into ./dev-items.ts — see ./plan.ts for why deps arrive as an object.
  const devItemActions = useDevItemActions({
    supabase,
    devItems,
    setDevItems,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });


  // ── client timeline: task order and marks ─────────────────────────────────────────
  // Lifted into ./timeline.ts — see ./plan.ts for why deps arrive as an object.
  const timeline = useTimelineActions({
    supabase,
    tasks,
    setTasks,
    timelineMarks,
    setTimelineMarks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });

  // ── reference links (0022) ─────────────────────────────────────────
  // Lifted into ./links.ts — see ./plan.ts for why deps arrive as an object.
  const linkActions = useLinkActions({
    supabase,
    links,
    setLinks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  });
  // ── moving hours, and writing them down to a client's Keys task ─────────────────────────────────────────
  // Lifted into ./keys-write-down.ts — see ./plan.ts for why deps arrive as an object.
  const keysWriteDown = useKeysWriteDown({
    supabase,
    setTimeEntries,
    setEntrySums,
    currentUserId,
    entries,
    wrote,
    noteWriteError,
    counting,
  });
  // ── intake requests ─────────────────────────────────────────
  // Lifted into ./requests.ts — see ./plan.ts for why deps arrive as an object.
  const requests = useRequestActions({
    supabase,
    tagNameById,
    setLinks,
    setTasks,
    clients,
    taskRequests,
    setTaskRequests,
    currentUserId,
    wrote,
    noteWriteError,
    counting,
  });


  const taskMinutes = useCallback(
    (taskId: string) => minutesByTask.get(taskId) ?? 0,
    [minutesByTask],
  );

  const value = useMemo<Store>(
    () => ({
      loading,
      profiles,
      clients,
      sections,
      taskGroups,
      tags: tagRows,
      tasks,
      comments,
      attachments,
      timeEntries,
      entrySums,
      entrySumsAll,
      currentUserId: viewAsProfile ? viewAsProfile.id : currentUserId,
      viewingAs: viewAsProfile ? viewAsProfile.name : null,
      openTaskId,
      planColumns,
      planEntries,
      billingPeriods,
      dayStates,
      links,
      timelineMarks,
      taskTypes,
      briefLoaded: isBriefLoaded,
      devItems,
      openTask,
      // ...tasks.ts — the studio structure. Last domain out of this file, and the
      // one every other domain reaches into through `methodsRef`.
      ...taskActions,
      // ...plan.ts — the domain's eleven methods arrive as one object, which is
      // also why the dependency list below names `plan` once rather than each.
      ...plan,
      ...linkActions,
      ...timeline,
      ...devItemActions,
      ...billing,
      ...entries,
      ...keysWriteDown,
      ...requests,
      ...commentActions,
      ...taxonomy,
      ...clientActions,
      taskRequests,
      taskMinutes,
      undo,
      redo,
      writeError,
      dismissWriteError,
      serviceBlocked,
      notice,
      showNotice,
      dismissNotice,
      freshEntryId,
      refreshing,
      pollingPaused,
      lastSyncedAt,
      refresh: refreshNow,
      bootError,
    }),
    [
      loading, profiles, clients, sections, taskGroups, tagRows, tasks, comments, attachments,
      timeEntries, entrySums, entrySumsAll, currentUserId, viewAsProfile, openTaskId,
      planColumns, planEntries, billingPeriods, dayStates, links, timelineMarks, taskTypes,
      isBriefLoaded, devItems, openTask, taskActions, plan, taskRequests, taskMinutes,
      undo, redo, writeError, dismissWriteError, serviceBlocked, notice, showNotice,
      dismissNotice, freshEntryId, refreshing, pollingPaused, lastSyncedAt, refreshNow,
      bootError, linkActions, timeline, devItemActions, billing, entries, keysWriteDown,
      requests, taxonomy, commentActions, clientActions,
    ],
  );

  /**
   * `?viewAs=` is a preview, and this is the line that enforces it — see
   * ./preview-guard.ts for what went wrong when nothing did.
   *
   * ⚠️ Only what leaves through the Provider is guarded. `methodsRef` below keeps
   * the UNGUARDED value on purpose: it is how the domains reach each other (an
   * undo step calling `deleteTimeEntry`, a plan drag reassigning a task), and
   * stubbing it would be guarding the machinery twice over. Nothing internal can
   * start on its own — every public entry point is already blocked.
   */
  const exposed = useMemo(
    () => guardPreview(value, viewAsProfile ? viewAsProfile.name : null),
    [value, viewAsProfile],
  );

  // history actions look methods up here — always the freshest closures
  useEffect(() => {
    methodsRef.current = value;
  }, [value]);

  return <StoreContext.Provider value={exposed}>{children}</StoreContext.Provider>;
}

export function useData(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useData must be used inside DataProvider");
  return store;
}

/** Like useData, but returns null outside a DataProvider (for shared UI primitives). */
export function useDataMaybe(): Store | null {
  return useContext(StoreContext);
}

/**
 * The signed-in member — or, under `?viewAs=`, the member an admin is previewing,
 * since the store swaps the exposed `currentUserId`. That is the whole point of
 * reading it through here: member preview keeps working everywhere for free.
 */
export function useMe(): Profile | null {
  const { profiles, currentUserId } = useData();
  return profiles.find((p) => p.id === currentUserId) ?? null;
}

export function useIsAdmin(): boolean {
  return useMe()?.role === "admin";
}
