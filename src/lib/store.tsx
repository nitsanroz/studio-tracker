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
import { createClient } from "./supabase/client";
import {
  mapBillingPeriod,
  mapClient,
  mapComment,
  mapDayState,
  mapDevItem,
  mapPlanColumn,
  mapPlanEntry,
  mapSection,
  mapTag,
  mapTask,
  mapTimeEntry,
  taskPatchToRow,
  type DbRow,
} from "./db";
import {
  fetchCold,
  fetchFull,
  fetchHot,
  fingerprint,
  mergeTasks,
  mergeTimeEntries,
  type ColdSnapshot,
  type HotCtx,
  type HotSnapshot,
} from "./snapshot";
import { toISODate } from "./format";
import type {
  AbsenceType,
  Attachment,
  BillingPeriod,
  Client,
  DayState,
  DevItem,
  DevStatus,
  EntrySum,
  UserEntrySum,
  PlanColumn,
  PlanEntry,
  PlanEntryType,
  Profile,
  Section,
  Tag,
  Task,
  TaskComment,
  TimeEntry,
} from "./types";

export interface TaskRequest {
  id: string;
  clientId: string | null;
  suggestedClientId: string | null;
  submitterName: string;
  submitterEmail: string;
  title: string;
  brief: string;
  requestedDueDate: string | null;
  budgetHours: number | null;
  status: "pending" | "approved" | "rejected";
  createdTaskId: string | null;
  createdAt: string;
  answers: Record<string, unknown> | null;
}

export interface ApproveRequestInput {
  clientId: string;
  sectionId: string | null;
  assigneeId: string | null;
  title: string;
  estimateHours: number | null;
  dueDate: string | null;
}

export interface NewPlanEntry {
  date: string | null;
  columnId: string;
  type: PlanEntryType;
  taskId?: string | null;
  text?: string;
  clientId?: string | null;
  absenceType?: AbsenceType | null;
}

export interface TimeEntryPatch {
  minutes?: number;
  description?: string;
  date?: string;
  /** admin-only: move the entry to another member */
  userId?: string;
}

interface Store {
  loading: boolean;
  profiles: Profile[];
  clients: Client[];
  sections: Section[];
  tags: Tag[];
  tasks: Task[];
  comments: TaskComment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  /**
   * Slim rows for time entries (no description) — for aggregations.
   * EXCLUDES pre-Everhour backfill: use this for anything personal or
   * time-series (my hours, days worked, the feed timesheet, per-member totals).
   */
  entrySums: UserEntrySum[];
  /**
   * Every entry including the recovered pre-Everhour history. Use for
   * CLIENT-FACING and per-task totals — client stats, reports, task hours —
   * where the 2020–2022 work is real and belongs in the number.
   */
  entrySumsAll: EntrySum[];
  currentUserId: string;
  /** Name of the member an admin is previewing as (?viewAs=…), null when off. */
  viewingAs: string | null;
  openTaskId: string | null;
  planColumns: PlanColumn[];
  planEntries: PlanEntry[];
  billingPeriods: BillingPeriod[];
  dayStates: DayState[];
  devItems: DevItem[];

  openTask: (taskId: string | null) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  /**
   * Apply one patch to many tasks in a single write, as ONE undo step.
   * Moving between clients must also set `sectionId` (a section belongs to
   * exactly one client, so the old id would strand the tasks).
   */
  updateTasksBulk: (taskIds: string[], patch: Partial<Task>) => void;
  /** Undo counterpart of updateTasksBulk: restores each task's own prior values. */
  restoreTasksBulk: (items: { id: string; patch: Partial<Task> }[]) => void;
  addTask: (clientId: string, sectionId: string | null, title: string) => void;
  /** Hard-delete a task. CASCADES to its time entries — confirm with the user first. */
  deleteTask: (taskId: string) => void;
  /** Hard-delete many tasks. CASCADES to time entries — confirm with the user first. */
  deleteTasksBulk: (taskIds: string[]) => void;
  addSection: (clientId: string, name: string) => void;
  updateSection: (sectionId: string, patch: Partial<Pick<Section, "name">>) => void;
  /** No-ops (with a visible write error) if the section still contains tasks. */
  deleteSection: (sectionId: string) => void;
  /** Move `movedId` before `beforeId` within its own section; null = to the end. */
  reorderTask: (movedId: string, beforeId: string | null) => void;
  /** Move a section before another within its own client; null = to the end. */
  reorderSection: (movedId: string, beforeId: string | null) => void;
  addClient: (name: string, color: string, billingPeriodNote?: string) => Promise<Client | null>;
  patchProfileLocal: (profileId: string, patch: Partial<Profile>) => void;
  updateProfile: (profileId: string, patch: Partial<Profile>) => void;
  updateClient: (clientId: string, patch: Partial<Client>) => void;
  addTag: (name: string, color: string) => void;
  updateTag: (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => void;
  deleteTag: (tagId: string) => void;
  addPlanEntry: (input: NewPlanEntry) => void;
  movePlanEntry: (entryId: string, target: { date: string | null; columnId: string }) => void;
  /**
   * The weekly plan's drop target: move the entry, and when it lands in a
   * DIFFERENT person's column, reassign the underlying task to them — as one
   * undo step. Falls back to a plain move when there is nobody to reassign to.
   */
  movePlanEntryToCell: (entryId: string, target: { date: string | null; columnId: string }) => void;
  deletePlanEntry: (entryId: string) => void;
  addPlanColumn: (name: string) => void;
  updatePlanColumn: (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => void;
  movePlanColumn: (columnId: string, direction: -1 | 1) => void;
  deletePlanColumn: (columnId: string) => void;
  addComment: (taskId: string, body: string) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  /** Resolves to the inserted entry (or null) so a caller can edit it immediately. */
  addTimeEntry: (
    taskId: string,
    minutes: number,
    description: string,
    date?: string,
    userId?: string,
  ) => Promise<TimeEntry | null>;
  /** One member's entries for one date. `timeEntries` only holds the recent 400. */
  loadDayEntries: (userId: string, dateIso: string) => Promise<TimeEntry[]>;
  /**
   * `userId` reassigns the entry to another member — admins only. RLS refuses it
   * for members anyway: `own time update`'s USING clause constrains the very
   * column being changed, and Postgres reuses it as the check on the new row.
   */
  updateTimeEntry: (entryId: string, patch: TimeEntryPatch) => void;
  deleteTimeEntry: (entryId: string) => void;
  moveTimeEntries: (entryIds: string[], fromTaskId: string, toTaskId: string) => void;
  addBillingPeriod: (input: Omit<BillingPeriod, "id" | "position" | "paid">) => void;
  updateBillingPeriod: (id: string, patch: Partial<BillingPeriod>) => void;
  deleteBillingPeriod: (id: string) => void;
  addDayState: (dateFrom: string, dateTo: string, label: string) => void;
  deleteDayState: (id: string) => void;
  addDevItem: (text: string) => void;
  updateDevItem: (id: string, patch: { text?: string; status?: DevStatus }) => void;
  deleteDevItem: (id: string) => void;
  taskRequests: TaskRequest[];
  approveRequest: (requestId: string, input: ApproveRequestInput) => Promise<void>;
  rejectRequest: (requestId: string) => void;
  taskMinutes: (taskId: string) => number;
  /** Undo/redo the last data actions (max 10). Also on cmd/ctrl+Z (+shift). */
  undo: () => void;
  redo: () => void;
  /** Set when a background write to Supabase fails; the UI surfaces a banner. */
  writeError: string | null;
  dismissWriteError: () => void;
  /**
   * A neutral, informational message — currently only "that undo expired".
   * Deliberately NOT writeError: that banner is about failed saves and says
   * "reload", neither of which applies here.
   */
  notice: string | null;
  dismissNotice: () => void;
  /** True while a background refresh is in flight (a quiet indicator, not a blocker). */
  refreshing: boolean;
  /** epoch ms of the last successful sync, for the indicator's tooltip. */
  lastSyncedAt: number | null;
  /** Force a refresh now (the interval and tab-focus do this automatically). */
  refresh: () => void;
  /**
   * Set when the initial load failed. Distinct from `writeError`: there is no
   * data at all, so the UI must not render an empty state that reads as "the
   * studio has nothing" — see AppShell.
   */
  bootError: string | null;
}

interface HistoryAction {
  undo: () => void;
  redo: () => void;
  /**
   * Which refresh generation this step was recorded against. An undo whose epoch
   * has moved on would push a value captured BEFORE a colleague's change back to
   * the server — silently reverting their edit. See `undo`.
   */
  epoch: number;
}

// ── background refresh cadence ──────────────────────────────────────────
/** Hot poll. A minute is inside "my colleague sees my drag soon" for the plan. */
const HOT_INTERVAL_MS = 60_000;
/** Studio structure (people, clients, sections, tags) every 10th hot tick. */
const COLD_EVERY_N_TICKS = 10;
/** Don't refetch for an alt-tab. */
const FOCUS_MIN_GAP_MS = 20_000;
/** Coming back after this long is worth a full refresh, not just the hot half. */
const COLD_AFTER_AWAY_MS = 5 * 60_000;
/** How long an in-flight write blocks a refresh before we assume it leaked. */
const WRITE_SETTLE_MS = 15_000;

/** prev values of exactly the patched keys — the inverse patch for undo */
function inversePatch<T extends object>(before: T, patch: Partial<T>): Partial<T> {
  const prev: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) prev[k] = before[k];
  return prev;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB-boundary row mapper (return type is explicit)
const mapTaskRequest = (r: any): TaskRequest => ({
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
});

const StoreContext = createContext<Store | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [dayStates, setDayStates] = useState<DayState[]>([]);
  const [devItems, setDevItems] = useState<DevItem[]>([]);
  const [tagRows, setTagRows] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [entrySumsAll, setEntrySums] = useState<EntrySum[]>([]);
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
  /** Bumped by boot AND every refresh, so a slow response can tell it's stale. */
  const generation = useRef(0);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const fingerprintRef = useRef<string | null>(null);
  const lastSyncedRef = useRef<number | null>(null);
  const refreshRef = useRef<((opts?: { cold?: boolean; reason?: string }) => void) | null>(null);
  /** What `fetchHot` needs from the cold half; kept in a ref so refresh() is stable. */
  const coldCtxRef = useRef<HotCtx>({ tagNames: new Map(), projectClient: new Map() });
  const openTaskIdRef = useRef<string | null>(null);

  // In-flight optimistic writes. A refresh must not land between the local
  // setState and the server commit, or the user's own edit flickers backwards.
  const writes = useRef(0);
  const lastWriteAt = useRef(0);
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
   * Inserts deliberately don't use this: a new row can't be clobbered — if the
   * refresh lands first the row simply isn't in the snapshot yet and the insert
   * callback appends it; if it lands after, the row is already there.
   */
  const wrote = useCallback(
    (label: string) => {
      writes.current++;
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

  // Task totals include the recovered history — that IS the task's real cost.
  const minutesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entrySumsAll) map.set(e.taskId, (map.get(e.taskId) ?? 0) + e.minutes);
    return map;
  }, [entrySumsAll]);

  // ── initial load ──────────────────────────────────────────────────────
  const applyCold = useCallback((c: ColdSnapshot) => {
    setProfiles(c.profiles);
    setClients(c.clients);
    setSections(c.sections);
    setTagRows(c.tags);
    setPlanColumns(c.planColumns);
    setBillingPeriods(c.billingPeriods);
    setDayStates(c.dayStates);
    // a hot-only refresh maps its tasks with these, so they must follow the cold half
    coldCtxRef.current = {
      tagNames: new Map(c.tags.map((t) => [t.id, t.name])),
      projectClient: c.projectClient,
    };
  }, []);

  const applyHot = useCallback((h: HotSnapshot) => {
    setTasks((prev) => mergeTasks(h.tasks, prev));
    setTimeEntries((prev) => mergeTimeEntries(h.timeEntries, h.entrySums, prev));
    // same commit as the 400-row window above, so the feed and the aggregates
    // can never disagree about which entries exist
    setEntrySums(h.entrySums);
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
      applyHot(snap);
      fingerprintRef.current = fingerprint(snap);
      lastSyncedRef.current = Date.now();
      setLoading(false);
    })().catch((e) => {
      console.error("store load failed", e);
      if (cancelled) return;
      // Without this the app renders as if the studio simply had no tasks,
      // clients or hours — an empty state is a claim about the data, and this
      // isn't one we can make. Surface it and offer a reload instead.
      setBootError(
        e instanceof Error && e.message ? e.message : "The studio data couldn't be loaded.",
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, applyCold, applyHot]);

  // ── lazy per-task detail (brief, comments, full entries) ─────────────
  /**
   * Each merge REPLACES this task's rows rather than appending unseen ones.
   * Append-dedup could never reflect a deleted or edited comment, which is
   * exactly what a background refresh needs to be able to do. Safe because each
   * query is `eq("task_id")` — a strict superset of what the list already holds
   * for that task.
   */
  const loadTaskExtras = useCallback(
    async (taskId: string) => {
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
    async (opts: { cold?: boolean; reason?: string } = {}) => {
      if (refreshInFlight.current) return;
      // Defer rather than clobber: a fresh snapshot landing between an optimistic
      // setState and its server commit would flicker the edit backwards. The
      // write tail re-runs this, and the next tick retries anyway.
      if (writesBusy() || focusInEditor()) {
        refreshQueued.current = true;
        return;
      }
      refreshInFlight.current = true;
      const mine = ++generation.current;
      setRefreshing(true);
      try {
        const cold = opts.cold ? await fetchCold(supabase) : null;
        const hot = await fetchHot(supabase, {
          tagNames: coldCtxRef.current.tagNames,
          projectClient: coldCtxRef.current.projectClient,
        });
        // A newer refresh (or a boot) started while we were waiting — drop this
        // response rather than overwrite fresher data with older data.
        if (mine !== generation.current) return;
        // An empty studio is never a real refresh result: it means the session
        // expired and RLS returned nothing. Applying it would blank the app.
        if (hot.tasks.length === 0 || (cold && cold.profiles.length === 0)) {
          throw new Error("refresh returned an empty studio — treating as auth, not data");
        }
        if (cold) applyCold(cold);
        applyHot(hot);

        const next = fingerprint(hot);
        const changed = fingerprintRef.current !== null && next !== fingerprintRef.current;
        fingerprintRef.current = next;
        // Someone else's change landed, so every undo step taken before it is now
        // built on values that are no longer current — see `undo`.
        if (changed) epoch.current++;
        lastSyncedRef.current = Date.now();
        setLastSyncedAt(Date.now());

        // The open task's comments/attachments are lazily loaded and were being
        // memoised forever, so the most collaborative surface in the app was the
        // one place a refresh couldn't reach.
        loadedTaskExtras.current.clear();
        const open = openTaskIdRef.current;
        if (open) {
          loadedTaskExtras.current.add(open);
          void loadTaskExtras(open);
        }
        if (changed) console.debug("[refresh]", opts.reason ?? "", { cold: !!cold, changed });
      } catch (e) {
        // Soft failure by design: keep the data we have, say nothing to the user.
        // A background tick failing is not something they can act on.
        console.warn("[refresh] failed", e);
      } finally {
        refreshInFlight.current = false;
        setRefreshing(false);
      }
    },
    [supabase, applyCold, applyHot, loadTaskExtras, writesBusy, focusInEditor],
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
    let ticks = 0;
    const id = setInterval(() => {
      if (document.hidden) return; // nothing to look at, nothing to fetch
      ticks++;
      void refreshRef.current?.({ cold: ticks % COLD_EVERY_N_TICKS === 0, reason: "interval" });
    }, HOT_INTERVAL_MS);
    const onFocus = () => {
      if (document.hidden) return;
      const since = Date.now() - (lastSyncedRef.current ?? 0);
      // macOS fires focus on every window switch; don't refetch for an alt-tab
      if (since < FOCUS_MIN_GAP_MS) return;
      void refreshRef.current?.({ cold: since > COLD_AFTER_AWAY_MS, reason: "focus" });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loading, bootError]);

  // ── mutations ─────────────────────────────────────────────────────────
  const updateTask = useCallback(
    (taskId: string, patch: Partial<Task>) => {
      const before = tasks.find((t) => t.id === taskId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateTask(taskId, prev),
          redo: () => methodsRef.current?.updateTask(taskId, patch),
        });
      }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
      supabase
        .from("tasks")
        .update(taskPatchToRow(patch, tagIdByName))
        .eq("id", taskId)
        .then(wrote("updateTask"));
    },
    [supabase, tagIdByName, tasks, record, wrote],
  );

  /**
   * Restores per-task prior values after a bulk update. Tasks that shared the
   * same prior value are grouped into one write, so undoing "move 40 tasks from
   * one client" costs a single round-trip rather than 40.
   */
  const restoreTasksBulk = useCallback(
    (items: { id: string; patch: Partial<Task> }[]) => {
      if (items.length === 0) return;
      const byPatch = new Map<string, { patch: Partial<Task>; ids: string[] }>();
      for (const it of items) {
        const key = JSON.stringify(it.patch);
        const group = byPatch.get(key);
        if (group) group.ids.push(it.id);
        else byPatch.set(key, { patch: it.patch, ids: [it.id] });
      }
      const patchById = new Map(items.map((it) => [it.id, it.patch]));
      setTasks((prev) =>
        prev.map((t) => {
          const p = patchById.get(t.id);
          return p ? { ...t, ...p } : t;
        }),
      );
      for (const { patch, ids } of byPatch.values()) {
        supabase
          .from("tasks")
          .update(taskPatchToRow(patch, tagIdByName))
          .in("id", ids)
          .then(wrote("restoreTasksBulk"));
      }
    },
    [supabase, tagIdByName, wrote],
  );

  const updateTasksBulk = useCallback(
    (taskIds: string[], patch: Partial<Task>) => {
      const ids = [...new Set(taskIds)];
      if (ids.length === 0) return;
      const idSet = new Set(ids);

      // Each task can hold a different prior value, so the inverse is a list of
      // per-task patches rather than one shared patch — but it is recorded as a
      // SINGLE history entry, so one ⌘Z reverses the whole selection.
      const before = tasks
        .filter((t) => idSet.has(t.id))
        .map((t) => ({ id: t.id, patch: inversePatch(t, patch) }));
      record({
        undo: () => methodsRef.current?.restoreTasksBulk(before),
        redo: () => methodsRef.current?.updateTasksBulk(ids, patch),
      });

      setTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...patch } : t)));
      supabase
        .from("tasks")
        .update(taskPatchToRow(patch, tagIdByName))
        .in("id", ids)
        .then(wrote("updateTasksBulk"));
    },
    [supabase, tagIdByName, tasks, record, wrote],
  );

  const addTask = useCallback(
    (clientId: string, sectionId: string | null, title: string) => {
      const position =
        Math.max(0, ...tasks.filter((t) => t.clientId === clientId).map((t) => t.position)) + 1;
      supabase
        .from("tasks")
        .insert({
          client_id: clientId,
          section_id: sectionId,
          title,
          billable: clients.find((c) => c.id === clientId)?.billable ?? true,
          position,
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTask", error);
            return;
          }
          setTasks((prev) => [...prev, mapTask(data, tagNameById)]);
        });
    },
    [supabase, tasks, tagNameById, clients, noteWriteError],
  );

  const addSection = useCallback(
    (clientId: string, name: string) => {
      const position =
        Math.max(0, ...sections.filter((s) => s.clientId === clientId).map((s) => s.position)) + 1;
      supabase
        .from("sections")
        .insert({ client_id: clientId, name, position })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addSection", error);
            return;
          }
          setSections((prev) => [...prev, mapSection(data)]);
        });
    },
    [supabase, sections, noteWriteError],
  );

  /**
   * Hard-delete a task. `time_entries`, comments and attachments all reference it
   * with ON DELETE CASCADE, so this destroys its logged hours too — callers must
   * confirm with the user first and say how much time is going.
   *
   * Deliberately NOT added to the undo history: the cascaded rows can't be brought
   * back, so an "undo" would restore the task and silently lose its hours, which is
   * worse than no undo at all. Published client reports are unaffected — they ship
   * frozen snapshots.
   */
  const deleteTask = useCallback(
    (taskId: string) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setTimeEntries((prev) => prev.filter((e) => e.taskId !== taskId));
      setEntrySums((prev) => prev.filter((e) => e.taskId !== taskId));
      supabase
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .then(wrote("deleteTask"));
    },
    [supabase, wrote],
  );

  // Deliberately NOT in the undo history, for the same reason as deleteTask:
  // time entries, comments and attachments are ON DELETE CASCADE, so an "undo"
  // would restore the tasks without their hours — worse than no undo at all.
  const deleteTasksBulk = useCallback(
    (taskIds: string[]) => {
      const ids = [...new Set(taskIds)];
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setTasks((prev) => prev.filter((t) => !idSet.has(t.id)));
      setTimeEntries((prev) => prev.filter((e) => !idSet.has(e.taskId)));
      setEntrySums((prev) => prev.filter((e) => !idSet.has(e.taskId)));
      supabase
        .from("tasks")
        .delete()
        .in("id", ids)
        .then(wrote("deleteTasksBulk"));
    },
    [supabase, wrote],
  );

  const updateSection = useCallback(
    (sectionId: string, patch: Partial<Pick<Section, "name">>) => {
      const before = sections.find((s) => s.id === sectionId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateSection(sectionId, prev),
          redo: () => methodsRef.current?.updateSection(sectionId, patch),
        });
      }
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)));
      supabase
        .from("sections")
        .update(patch)
        .eq("id", sectionId)
        .then(wrote("updateSection"));
    },
    [supabase, sections, record, wrote],
  );

  /** Refuses if any task still points at the section — deleting one with tasks in it
   *  would orphan them (the FK is ON DELETE SET NULL, so they'd silently reappear
   *  under "No section" with no way to tell where they came from). */
  const deleteSection = useCallback(
    (sectionId: string) => {
      if (tasks.some((t) => t.sectionId === sectionId)) {
        noteWriteError("deleteSection", { message: "Section still has tasks" });
        return;
      }
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
      supabase
        .from("sections")
        .delete()
        .eq("id", sectionId)
        .then(wrote("deleteSection"));
    },
    [supabase, tasks, wrote, noteWriteError],
  );

  /**
   * Reorder tasks inside one section: `movedId` is placed before `beforeId`
   * (or last when null). Positions are rewritten as a dense 1..n sequence for the
   * section, which keeps them stable instead of drifting toward collisions the way
   * midpoint/fractional schemes do after enough moves.
   */
  const reorderTask = useCallback(
    (movedId: string, beforeId: string | null) => {
      const moved = tasks.find((t) => t.id === movedId);
      if (!moved) return;

      const siblings = tasks
        .filter((t) => t.clientId === moved.clientId && t.sectionId === moved.sectionId)
        .sort((a, b) => a.position - b.position);

      const without = siblings.filter((t) => t.id !== movedId);
      const at = beforeId ? without.findIndex((t) => t.id === beforeId) : without.length;
      if (at === -1) return;
      const ordered = [...without.slice(0, at), moved, ...without.slice(at)];

      const changed = ordered
        .map((t, i) => ({ id: t.id, position: i + 1, was: t.position }))
        .filter((r) => r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      record({
        undo: () => {
          setTasks((prev) =>
            prev.map((t) => (prevById.has(t.id) ? { ...t, position: prevById.get(t.id)! } : t)),
          );
          for (const [id, position] of prevById) {
            supabase
              .from("tasks")
              .update({ position })
              .eq("id", id)
              .then(wrote("reorderTask undo"));
          }
        },
        redo: () => methodsRef.current?.reorderTask(movedId, beforeId),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setTasks((prev) =>
        prev.map((t) => (posById.has(t.id) ? { ...t, position: posById.get(t.id)! } : t)),
      );
      for (const { id, position } of changed) {
        supabase
          .from("tasks")
          .update({ position })
          .eq("id", id)
          .then(wrote("reorderTask"));
      }
    },
    [supabase, tasks, record, wrote],
  );

  /**
   * Reorder sections inside one client, exactly as `reorderTask` does for tasks:
   * dense 1..n, only changed rows written, one undo step.
   *
   * NOTE on existing data: the imports never set `sections.position`, so many
   * clients have every section at 0 and their display order is incidental — the
   * first drag in such a client assigns real positions to all of its sections.
   */
  const reorderSection = useCallback(
    (movedId: string, beforeId: string | null) => {
      const moved = sections.find((s) => s.id === movedId);
      if (!moved || movedId === beforeId) return;

      const siblings = sections
        .filter((s) => s.clientId === moved.clientId)
        .sort((a, b) => a.position - b.position);
      const without = siblings.filter((s) => s.id !== movedId);
      const at = beforeId ? without.findIndex((s) => s.id === beforeId) : without.length;
      if (at === -1) return;
      const ordered = [...without.slice(0, at), moved, ...without.slice(at)];

      const changed = ordered
        .map((s, i) => ({ id: s.id, position: i + 1, was: s.position }))
        .filter((r) => r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      record({
        undo: () => {
          setSections((prev) =>
            prev.map((s) => (prevById.has(s.id) ? { ...s, position: prevById.get(s.id)! } : s)),
          );
          for (const [id, position] of prevById) {
            supabase
              .from("sections")
              .update({ position })
              .eq("id", id)
              .then(wrote("reorderSection undo"));
          }
        },
        redo: () => methodsRef.current?.reorderSection(movedId, beforeId),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setSections((prev) =>
        prev.map((s) => (posById.has(s.id) ? { ...s, position: posById.get(s.id)! } : s)),
      );
      for (const { id, position } of changed) {
        supabase
          .from("sections")
          .update({ position })
          .eq("id", id)
          .then(wrote("reorderSection"));
      }
    },
    [supabase, sections, record, wrote],
  );

  const addClient = useCallback(
    async (name: string, color: string, billingPeriodNote?: string): Promise<Client | null> => {
      const { data, error } = await supabase
        .from("clients")
        .insert({ name, color, billing_period_note: billingPeriodNote ?? "" })
        .select()
        .single();
      if (error) {
        noteWriteError("addClient", error);
        return null;
      }
      const client = mapClient(data);
      setClients((prev) => [...prev, client]);
      return client;
    },
    [supabase, noteWriteError],
  );

  const patchProfileLocal = useCallback((profileId: string, patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
  }, []);

  const updateProfile = useCallback(
    (profileId: string, patch: Partial<Profile>) => {
      const before = profiles.find((p) => p.id === profileId);
      // An end date and `active` are two halves of one fact, and migration 0020
      // enforces the first half in the DB (a trigger). Mirror it here so the UI
      // doesn't briefly disagree with the row, and close the other direction too:
      // restoring somebody has to clear the date, or the trigger just re-archives
      // them and the button looks broken.
      if (patch.endDate) patch = { ...patch, active: false };
      else if (patch.active === true && before?.endDate) patch = { ...patch, endDate: null };
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateProfile(profileId, prev),
          redo: () => methodsRef.current?.updateProfile(profileId, patch),
        });
      }
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("role" in patch) row.role = patch.role;
      if ("active" in patch) row.active = patch.active;
      if ("startDate" in patch) row.start_date = patch.startDate;
      if ("endDate" in patch) row.end_date = patch.endDate;
      if ("capacityHoursWeek" in patch) row.capacity_hours_week = patch.capacityHoursWeek;
      supabase
        .from("profiles")
        .update(row)
        .eq("id", profileId)
        .then(wrote("updateProfile"));
    },
    [supabase, profiles, record, wrote],
  );

  const addTag = useCallback(
    (name: string, color: string) => {
      const position = Math.max(0, ...tagRows.map((_, i) => i + 1)) + 1;
      supabase
        .from("tags")
        .insert({ name, color, position })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTag", error);
            return;
          }
          setTagRows((prev) => [...prev, mapTag(data)]);
        });
    },
    [supabase, tagRows, noteWriteError],
  );

  const updateTag = useCallback(
    (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => {
      const beforeTag = tagRows.find((t) => t.id === tagId);
      if (beforeTag) {
        const prev = inversePatch(beforeTag, patch);
        record({
          undo: () => methodsRef.current?.updateTag(tagId, prev),
          redo: () => methodsRef.current?.updateTag(tagId, patch),
        });
      }
      const oldName = tagRows.find((t) => t.id === tagId)?.name;
      setTagRows((prev) => prev.map((t) => (t.id === tagId ? { ...t, ...patch } : t)));
      // tasks carry tag NAMES — keep them in sync on rename
      if (patch.name && oldName && patch.name !== oldName) {
        setTasks((prev) => prev.map((t) => (t.tag === oldName ? { ...t, tag: patch.name! } : t)));
      }
      supabase
        .from("tags")
        .update(patch)
        .eq("id", tagId)
        .then(wrote("updateTag"));
    },
    [supabase, tagRows, record, wrote],
  );

  const deleteTag = useCallback(
    (tagId: string) => {
      const name = tagRows.find((t) => t.id === tagId)?.name;
      setTagRows((prev) => prev.filter((t) => t.id !== tagId));
      if (name) setTasks((prev) => prev.map((t) => (t.tag === name ? { ...t, tag: null } : t)));
      supabase
        .from("tags")
        .delete()
        .eq("id", tagId)
        .then(wrote("deleteTag"));
    },
    [supabase, tagRows, wrote],
  );

  const updateClient = useCallback(
    (clientId: string, patch: Partial<Client>) => {
      // billable flips cascade to tasks — too side-effectful to undo cleanly
      const before = "billable" in patch ? undefined : clients.find((c) => c.id === clientId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateClient(clientId, prev),
          redo: () => methodsRef.current?.updateClient(clientId, patch),
        });
      }
      setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...patch } : c)));
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("color" in patch) row.color = patch.color;
      if ("archived" in patch) row.archived = patch.archived;
      if ("billingPeriodNote" in patch) row.billing_period_note = patch.billingPeriodNote;
      if ("billable" in patch) row.billable = patch.billable;
      if ("invoiceNote" in patch) row.invoice_note = patch.invoiceNote;
      supabase
        .from("clients")
        .update(row)
        .eq("id", clientId)
        .then(wrote("updateClient"));
      // Marking a client internal makes all its existing tasks non-billable.
      // The reverse is NOT mass-applied (keys tasks etc. must stay non-billable).
      if (patch.billable === false) {
        setTasks((prev) =>
          prev.map((t) => (t.clientId === clientId ? { ...t, billable: false } : t)),
        );
        supabase
          .from("tasks")
          .update({ billable: false })
          .eq("client_id", clientId)
          .then(wrote("updateClient tasks-billable"));
      }
    },
    [supabase, clients, record, wrote],
  );

  /** Re-insert a deleted plan entry with its original id (undo support). */
  const restorePlanEntry = useCallback(
    (entry: PlanEntry) => {
      setPlanEntries((prev) => [...prev.filter((e) => e.id !== entry.id), entry]);
      supabase
        .from("plan_entries")
        .insert({
          id: entry.id,
          date: entry.date,
          column_id: entry.columnId,
          position: entry.position,
          type: entry.type,
          task_id: entry.taskId,
          text: entry.text,
          client_id: entry.clientId,
          absence_type: entry.absenceType,
        })
        .then(wrote("restorePlanEntry"));
    },
    [supabase, wrote],
  );

  const addPlanEntry = useCallback(
    (input: NewPlanEntry) => {
      const position =
        Math.max(
          -1,
          ...planEntries
            .filter((e) => e.columnId === input.columnId && e.date === input.date)
            .map((e) => e.position),
        ) + 1;
      supabase
        .from("plan_entries")
        .insert({
          date: input.date,
          column_id: input.columnId,
          position,
          type: input.type,
          task_id: input.taskId ?? null,
          text: input.text ?? "",
          client_id: input.clientId ?? null,
          absence_type: input.absenceType ?? null,
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addPlanEntry", error);
            return;
          }
          const entry = mapPlanEntry(data);
          setPlanEntries((prev) => [...prev, entry]);
          record({
            undo: () => methodsRef.current?.deletePlanEntry(entry.id),
            redo: () => restorePlanEntry(entry),
          });
        });
    },
    [supabase, planEntries, record, restorePlanEntry, noteWriteError],
  );

  const movePlanEntry = useCallback(
    (entryId: string, target: { date: string | null; columnId: string }) => {
      const before = planEntries.find((e) => e.id === entryId);
      if (before) {
        const prev = { date: before.date, columnId: before.columnId };
        record({
          undo: () => methodsRef.current?.movePlanEntry(entryId, prev),
          redo: () => methodsRef.current?.movePlanEntry(entryId, target),
        });
      }
      const position =
        Math.max(
          -1,
          ...planEntries
            .filter((e) => e.columnId === target.columnId && e.date === target.date && e.id !== entryId)
            .map((e) => e.position),
        ) + 1;
      setPlanEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, ...target, position } : e)),
      );
      supabase
        .from("plan_entries")
        .update({ date: target.date, column_id: target.columnId, position })
        .eq("id", entryId)
        .then(wrote("movePlanEntry"));
    },
    [supabase, planEntries, record, wrote],
  );

  /**
   * What the weekly plan's cells actually call. Reassigns the task ONLY when all
   * of these hold — otherwise it is a plain move:
   *  · the entry is task-linked (free text and absences carry no task)
   *  · the column actually changed (another day in the same column is not a
   *    reassignment)
   *  · the target column is a real person — `type: "member"` WITH a profileId, so
   *    "Studio", "Waiting list" and name-only columns like "Freelancers" are out
   *  · the task isn't already theirs
   *
   * Dragging OUT of someone into Studio or the waiting list deliberately does NOT
   * clear the assignee: unscheduled is not unassigned.
   */
  const movePlanEntryToCell = useCallback(
    (entryId: string, target: { date: string | null; columnId: string }) => {
      const entry = planEntries.find((e) => e.id === entryId);
      const col = planColumns.find((c) => c.id === target.columnId);
      const task = entry?.taskId ? tasks.find((t) => t.id === entry.taskId) : null;
      const to = col?.type === "member" ? col.profileId : null;

      if (!entry || !task || !to || entry.columnId === target.columnId || task.assigneeId === to) {
        movePlanEntry(entryId, target);
        return;
      }
      const back = { date: entry.date, columnId: entry.columnId };
      const wasAssignedTo = task.assigneeId;
      asOneStep(
        {
          undo: () => {
            methodsRef.current?.updateTask(task.id, { assigneeId: wasAssignedTo });
            methodsRef.current?.movePlanEntry(entryId, back);
          },
          redo: () => methodsRef.current?.movePlanEntryToCell(entryId, target),
        },
        () => {
          // Both read their own pre-call snapshots, so running them in one tick is
          // safe; the two setStates batch into a single commit.
          movePlanEntry(entryId, target);
          methodsRef.current?.updateTask(task.id, { assigneeId: to });
        },
      );
    },
    [planEntries, planColumns, tasks, movePlanEntry, asOneStep],
  );

  const deletePlanEntry = useCallback(
    (entryId: string) => {
      const before = planEntries.find((e) => e.id === entryId);
      if (before) {
        record({
          undo: () => restorePlanEntry(before),
          redo: () => methodsRef.current?.deletePlanEntry(entryId),
        });
      }
      setPlanEntries((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("plan_entries")
        .delete()
        .eq("id", entryId)
        .then(wrote("deletePlanEntry"));
    },
    [supabase, planEntries, record, restorePlanEntry, wrote],
  );

  const addPlanColumn = useCallback(
    (name: string) => {
      const memberCols = planColumns.filter((c) => c.type !== "waiting_list");
      const position = Math.max(0, ...memberCols.map((c) => c.position)) + 1;
      supabase
        .from("plan_columns")
        .insert({ name, type: "member", position })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addPlanColumn", error);
            return;
          }
          setPlanColumns((prev) => [...prev, mapPlanColumn(data)]);
        });
    },
    [supabase, planColumns, noteWriteError],
  );

  const updatePlanColumn = useCallback(
    (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => {
      const prev = planColumns;
      setPlanColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, ...patch } : c)));
      supabase
        .from("plan_columns")
        .update(patch)
        .eq("id", columnId)
        .then((res) => {
          wrote("updatePlanColumn")(res);
          if (res.error) setPlanColumns(prev); // e.g. `hidden` migration not applied yet
        });
    },
    [supabase, planColumns, wrote],
  );

  const movePlanColumn = useCallback(
    (columnId: string, direction: -1 | 1) => {
      const ordered = planColumns
        .filter((c) => c.type !== "waiting_list")
        .sort((a, b) => a.position - b.position);
      const idx = ordered.findIndex((c) => c.id === columnId);
      const swapWith = ordered[idx + direction];
      if (idx < 0 || !swapWith) return;
      const a = ordered[idx];
      setPlanColumns((cols) =>
        cols.map((c) =>
          c.id === a.id
            ? { ...c, position: swapWith.position }
            : c.id === swapWith.id
              ? { ...c, position: a.position }
              : c,
        ),
      );
      supabase
        .from("plan_columns")
        .update({ position: swapWith.position })
        .eq("id", a.id)
        .then(wrote("movePlanColumn"));
      supabase
        .from("plan_columns")
        .update({ position: a.position })
        .eq("id", swapWith.id)
        .then(wrote("movePlanColumn"));
    },
    [supabase, planColumns, wrote],
  );

  const deletePlanColumn = useCallback(
    (columnId: string) => {
      setPlanColumns((prev) => prev.filter((c) => c.id !== columnId));
      setPlanEntries((prev) => prev.filter((e) => e.columnId !== columnId));
      supabase
        .from("plan_columns")
        .delete()
        .eq("id", columnId)
        .then(wrote("deletePlanColumn"));
    },
    [supabase, wrote],
  );

  const addComment = useCallback(
    (taskId: string, body: string) => {
      const optimistic: TaskComment = {
        id: `tmp-${Date.now()}`,
        taskId,
        userId: currentUserId,
        body,
        createdAt: new Date().toISOString(),
      };
      setComments((prev) => [...prev, optimistic]);
      supabase
        .from("task_comments")
        .insert({ task_id: taskId, user_id: currentUserId, body })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addComment", error);
            return;
          }
          setComments((prev) => prev.map((c) => (c.id === optimistic.id ? mapComment(data) : c)));
        });
    },
    [supabase, currentUserId, noteWriteError],
  );

  const addAttachment = useCallback((attachment: Attachment) => {
    setAttachments((prev) => [...prev, attachment]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const applyEntryLocally = useCallback((entry: TimeEntry) => {
    setTimeEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    setEntrySums((prev) => [
      {
        id: entry.id,
        taskId: entry.taskId,
        userId: entry.userId,
        date: entry.date,
        minutes: entry.minutes,
        legacy: entry.legacy,
        dateEstimated: entry.dateEstimated,
      },
      ...prev.filter((e) => e.id !== entry.id),
    ]);
  }, []);

  /**
   * Re-insert a deleted time entry with its original id (undo support).
   *
   * It MUST carry `legacy` and its companions. This used to write only
   * id/task/user/date/minutes/description, so undoing the deletion of a recovered
   * pre-Everhour entry brought it back as an ORDINARY one — and its hours then
   * leaked into days-worked, tenure, "my hours" and the feed timesheet, which is
   * exactly what the flag exists to prevent.
   */
  const restoreTimeEntry = useCallback(
    (entry: TimeEntry) => {
      applyEntryLocally(entry);
      supabase
        .from("time_entries")
        .insert({
          id: entry.id,
          task_id: entry.taskId,
          user_id: entry.userId,
          date: entry.date,
          minutes: entry.minutes,
          description: entry.description,
          legacy: entry.legacy ?? false,
          date_estimated: entry.dateEstimated ?? false,
          legacy_author_name: entry.legacyAuthorName ?? null,
          moved_from_task_id: entry.movedFromTaskId,
        })
        .then(wrote("restoreTimeEntry"));
    },
    [supabase, applyEntryLocally, wrote],
  );

  /** Resolves to the inserted entry, so a caller can edit it without a reload. */
  const addTimeEntry = useCallback(
    async (
      taskId: string,
      minutes: number,
      description: string,
      date?: string,
      userId?: string,
    ): Promise<TimeEntry | null> => {
      const { data, error } = await supabase
        .from("time_entries")
        .insert({
          task_id: taskId,
          // admins may log hours for another member (e.g. from the timesheet day popup)
          user_id: userId ?? currentUserId,
          date: date ?? toISODate(new Date()),
          minutes,
          description,
        })
        .select()
        .single();
      if (error) {
        noteWriteError("addTimeEntry", error);
        return null;
      }
      const entry = mapTimeEntry(data);
      applyEntryLocally(entry);
      record({
        undo: () => methodsRef.current?.deleteTimeEntry(entry.id),
        redo: () => restoreTimeEntry(entry),
      });
      return entry;
    },
    [supabase, currentUserId, applyEntryLocally, record, restoreTimeEntry, noteWriteError],
  );

  /**
   * One member's entries for one day, straight from the DB.
   *
   * The store's `timeEntries` is only the most recent 400 rows studio-wide, so
   * it cannot answer "what did I log on 3 March" — hence a real query. It lives
   * here rather than in the component so the Supabase client and the row
   * mappers stay behind one boundary; "Log my hours" used to open its own
   * client and call mapTimeEntry itself.
   */
  const loadDayEntries = useCallback(
    async (userId: string, dateIso: string): Promise<TimeEntry[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("date", dateIso)
        .not("minutes", "is", null)
        .order("created_at");
      if (error) {
        console.error("loadDayEntries failed", error.message);
        return [];
      }
      return (data ?? []).map(mapTimeEntry);
    },
    [supabase],
  );

  const updateTimeEntry = useCallback(
    (entryId: string, patch: TimeEntryPatch) => {
      // full row if loaded; the slim sums row covers minutes/date-only patches
      const before =
        timeEntries.find((e) => e.id === entryId) ??
        ("description" in patch ? undefined : entrySumsAll.find((e) => e.id === entryId));
      if (before) {
        const prev: TimeEntryPatch = {};
        if ("minutes" in patch) prev.minutes = before.minutes;
        if ("date" in patch) prev.date = before.date;
        if ("description" in patch) prev.description = (before as TimeEntry).description;
        // without this an undo would leave the reassignment in place
        if ("userId" in patch) prev.userId = before.userId ?? undefined;
        record({
          undo: () => methodsRef.current?.updateTimeEntry(entryId, prev),
          redo: () => methodsRef.current?.updateTimeEntry(entryId, patch),
        });
      }
      setTimeEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
      if (patch.minutes != null || patch.date != null || patch.userId != null) {
        // entrySums is the per-person source behind days-worked, tenure, the week
        // timesheet and "avg / designer", so a reassignment has to reach it too
        setEntrySums((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  ...(patch.minutes != null && { minutes: patch.minutes }),
                  ...(patch.date != null && { date: patch.date }),
                  ...(patch.userId != null && { userId: patch.userId }),
                }
              : e,
          ),
        );
      }
      // Built explicitly: this used to pass `patch` straight to .update() and got
      // away with it only because minutes/description/date are spelled the same
      // in camelCase and snake_case. `userId` is not.
      const row: DbRow = {};
      if ("minutes" in patch) row.minutes = patch.minutes;
      if ("description" in patch) row.description = patch.description;
      if ("date" in patch) row.date = patch.date;
      if ("userId" in patch) row.user_id = patch.userId;
      supabase
        .from("time_entries")
        .update(row)
        .eq("id", entryId)
        .then(wrote("updateTimeEntry"));
    },
    [supabase, timeEntries, entrySumsAll, record, wrote],
  );

  const deleteTimeEntry = useCallback(
    (entryId: string) => {
      const full = timeEntries.find((e) => e.id === entryId);
      const slim = entrySumsAll.find((e) => e.id === entryId);
      const before: TimeEntry | undefined =
        full ?? (slim ? { ...slim, description: "", movedFromTaskId: null } : undefined);
      if (before) {
        record({
          undo: () => restoreTimeEntry(before),
          redo: () => methodsRef.current?.deleteTimeEntry(entryId),
        });
      }
      setTimeEntries((prev) => prev.filter((e) => e.id !== entryId));
      setEntrySums((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("time_entries")
        .delete()
        .eq("id", entryId)
        .then(wrote("deleteTimeEntry"));
    },
    [supabase, timeEntries, entrySumsAll, record, restoreTimeEntry, wrote],
  );

  /** Re-insert a deleted billing period with its original id (undo support). */
  const restoreBillingPeriod = useCallback(
    (p: BillingPeriod) => {
      setBillingPeriods((prev) =>
        [...prev.filter((x) => x.id !== p.id), p].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
      );
      supabase
        .from("client_billing_periods")
        .insert({
          id: p.id,
          client_id: p.clientId,
          label: p.label,
          date_from: p.dateFrom,
          date_to: p.dateTo,
          hour_cap: p.hourCap,
          advance_hours: p.advanceHours,
          position: p.position,
          // omit `paid: false` so the insert also works before migration 0010
          ...(p.paid && { paid: true }),
        })
        .then(wrote("restoreBillingPeriod"));
    },
    [supabase, wrote],
  );

  const addBillingPeriod = useCallback(
    (input: Omit<BillingPeriod, "id" | "position" | "paid">) => {
      const position =
        Math.max(0, ...billingPeriods.filter((p) => p.clientId === input.clientId).map((p) => p.position)) + 1;
      supabase
        .from("client_billing_periods")
        .insert({
          client_id: input.clientId,
          label: input.label,
          date_from: input.dateFrom,
          date_to: input.dateTo,
          hour_cap: input.hourCap,
          advance_hours: input.advanceHours,
          position,
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addBillingPeriod", error);
            return;
          }
          const period = mapBillingPeriod(data);
          setBillingPeriods((prev) =>
            [...prev, period].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
          );
          record({
            undo: () => methodsRef.current?.deleteBillingPeriod(period.id),
            redo: () => restoreBillingPeriod(period),
          });
        });
    },
    [supabase, billingPeriods, record, restoreBillingPeriod, noteWriteError],
  );

  const updateBillingPeriod = useCallback(
    (id: string, patch: Partial<BillingPeriod>) => {
      const before = billingPeriods.find((p) => p.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateBillingPeriod(id, prev),
          redo: () => methodsRef.current?.updateBillingPeriod(id, patch),
        });
      }
      setBillingPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      const row: Record<string, unknown> = {};
      if ("label" in patch) row.label = patch.label;
      if ("dateFrom" in patch) row.date_from = patch.dateFrom;
      if ("dateTo" in patch) row.date_to = patch.dateTo;
      if ("hourCap" in patch) row.hour_cap = patch.hourCap;
      if ("advanceHours" in patch) row.advance_hours = patch.advanceHours;
      if ("paid" in patch) row.paid = patch.paid;
      supabase
        .from("client_billing_periods")
        .update(row)
        .eq("id", id)
        .then(wrote("updateBillingPeriod"));
    },
    [supabase, billingPeriods, record, wrote],
  );

  const deleteBillingPeriod = useCallback(
    (id: string) => {
      const before = billingPeriods.find((p) => p.id === id);
      if (before) {
        record({
          undo: () => restoreBillingPeriod(before),
          redo: () => methodsRef.current?.deleteBillingPeriod(id),
        });
      }
      setBillingPeriods((prev) => prev.filter((p) => p.id !== id));
      supabase
        .from("client_billing_periods")
        .delete()
        .eq("id", id)
        .then(wrote("deleteBillingPeriod"));
    },
    [supabase, billingPeriods, record, restoreBillingPeriod, wrote],
  );

  const addDayState = useCallback(
    (dateFrom: string, dateTo: string, label: string) => {
      supabase
        .from("plan_day_states")
        .insert({ date_from: dateFrom, date_to: dateTo, label, created_by: currentUserId })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addDayState", error);
            return;
          }
          setDayStates((prev) => [...prev, mapDayState(data)]);
        });
    },
    [supabase, currentUserId, noteWriteError],
  );

  const deleteDayState = useCallback(
    (id: string) => {
      setDayStates((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("plan_day_states")
        .delete()
        .eq("id", id)
        .then(wrote("deleteDayState"));
    },
    [supabase, wrote],
  );

  const addDevItem = useCallback(
    (text: string) => {
      const position = Math.max(0, ...devItems.map((d) => d.position)) + 1;
      supabase
        .from("dev_items")
        .insert({ text, position })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addDevItem", error);
            return;
          }
          setDevItems((prev) => [...prev, mapDevItem(data)]);
        });
    },
    [supabase, devItems, noteWriteError],
  );

  const updateDevItem = useCallback(
    (id: string, patch: { text?: string; status?: DevStatus }) => {
      const before = devItems.find((d) => d.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateDevItem(id, prev),
          redo: () => methodsRef.current?.updateDevItem(id, patch),
        });
      }
      setDevItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
      supabase
        .from("dev_items")
        .update(patch)
        .eq("id", id)
        .then(wrote("updateDevItem"));
    },
    [supabase, devItems, record, wrote],
  );

  const deleteDevItem = useCallback(
    (id: string) => {
      setDevItems((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("dev_items")
        .delete()
        .eq("id", id)
        .then(wrote("deleteDevItem"));
    },
    [supabase, wrote],
  );

  const moveTimeEntries = useCallback(
    (entryIds: string[], fromTaskId: string, toTaskId: string) => {
      const idSet = new Set(entryIds);
      setTimeEntries((prev) =>
        prev.map((e) =>
          idSet.has(e.id) ? { ...e, taskId: toTaskId, movedFromTaskId: fromTaskId } : e,
        ),
      );
      setEntrySums((prev) =>
        prev.map((e) => (idSet.has(e.id) ? { ...e, taskId: toTaskId } : e)),
      );
      supabase
        .from("time_entries")
        .update({
          task_id: toTaskId,
          moved_from_task_id: fromTaskId,
          moved_at: new Date().toISOString(),
          moved_by: currentUserId,
        })
        .in("id", entryIds)
        .then(wrote("moveTimeEntries"));
    },
    [supabase, currentUserId, wrote],
  );

  const approveRequest = useCallback(
    async (requestId: string, input: ApproveRequestInput) => {
      const request = taskRequests.find((r) => r.id === requestId);
      if (!request) return;
      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          client_id: input.clientId,
          section_id: input.sectionId,
          title: input.title,
          brief: request.brief,
          status: "todo",
          assignee_id: input.assigneeId,
          due_date: input.dueDate,
          billable: clients.find((c) => c.id === input.clientId)?.billable ?? true,
          estimate_hours: input.estimateHours,
        })
        .select()
        .single();
      if (error) {
        noteWriteError("approveRequest", error);
        throw new Error(error.message);
      }
      await supabase
        .from("task_requests")
        .update({ status: "approved", created_task_id: task.id, client_id: input.clientId })
        .eq("id", requestId);
      setTasks((prev) => [...prev, mapTask(task, tagNameById)]);
      setTaskRequests((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, status: "approved" as const, createdTaskId: task.id } : r,
        ),
      );
    },
    [supabase, taskRequests, tagNameById, clients, noteWriteError],
  );

  const rejectRequest = useCallback(
    (requestId: string) => {
      setTaskRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" as const } : r)),
      );
      supabase
        .from("task_requests")
        .update({ status: "rejected" })
        .eq("id", requestId)
        .then(wrote("rejectRequest"));
    },
    [supabase, wrote],
  );

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
      devItems,
      openTask,
      updateTask,
      updateTasksBulk,
      restoreTasksBulk,
      addTask,
      deleteTask,
      deleteTasksBulk,
      addSection,
      updateSection,
      deleteSection,
      reorderTask,
      reorderSection,
      addClient,
      patchProfileLocal,
      updateProfile,
      updateClient,
      addTag,
      updateTag,
      deleteTag,
      addPlanEntry,
      movePlanEntry,
      movePlanEntryToCell,
      deletePlanEntry,
      addPlanColumn,
      updatePlanColumn,
      movePlanColumn,
      deletePlanColumn,
      addComment,
      addAttachment,
      removeAttachment,
      addTimeEntry, loadDayEntries,
      updateTimeEntry,
      deleteTimeEntry,
      moveTimeEntries,
      addBillingPeriod,
      updateBillingPeriod,
      deleteBillingPeriod,
      addDayState,
      deleteDayState,
      addDevItem,
      updateDevItem,
      deleteDevItem,
      taskRequests,
      approveRequest,
      rejectRequest,
      taskMinutes,
      undo,
      redo,
      writeError,
      dismissWriteError,
      notice,
      dismissNotice,
      refreshing,
      lastSyncedAt,
      refresh: refreshNow,
      bootError,
    }),
    [
      loading, profiles, clients, sections, tagRows, tasks, comments, attachments, timeEntries, entrySums, entrySumsAll,
      currentUserId, viewAsProfile, openTaskId, planColumns, planEntries, billingPeriods, dayStates, devItems,
      openTask, updateTask, updateTasksBulk, restoreTasksBulk, addTask, deleteTask, deleteTasksBulk, addSection, updateSection, deleteSection, reorderTask, reorderSection, addClient, patchProfileLocal, updateProfile, updateClient, addTag, updateTag, deleteTag, addPlanEntry, movePlanEntry, movePlanEntryToCell, deletePlanEntry, addPlanColumn, updatePlanColumn, movePlanColumn, deletePlanColumn, addComment, addAttachment, removeAttachment, addTimeEntry, loadDayEntries, updateTimeEntry, deleteTimeEntry, moveTimeEntries, addBillingPeriod, updateBillingPeriod, deleteBillingPeriod, addDayState, deleteDayState, addDevItem, updateDevItem, deleteDevItem, taskRequests, approveRequest, rejectRequest, taskMinutes, undo, redo, writeError, dismissWriteError, notice, dismissNotice, refreshing, lastSyncedAt, refreshNow, bootError,
    ],
  );

  // history actions look methods up here — always the freshest closures
  useEffect(() => {
    methodsRef.current = value;
  }, [value]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
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
