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
  fetchAll,
  mapBillingPeriod,
  mapClient,
  mapComment,
  mapDayState,
  mapDevItem,
  mapEntrySum,
  mapPlanColumn,
  mapPlanEntry,
  mapProfile,
  mapSection,
  mapTag,
  mapTask,
  mapTimeEntry,
  taskPatchToRow,
  type DbRow,
} from "./db";
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
  /** Slim rows for ALL time entries (no description) — for aggregations. */
  entrySums: EntrySum[];
  currentUserId: string;
  /** Name of the member an admin is previewing as (?viewAs=…), null when off. */
  viewingAs: string | null;
  /** Everhour entries that couldn't be imported and need an admin to resolve. */
  openSyncIssues: number;
  openTaskId: string | null;
  planColumns: PlanColumn[];
  planEntries: PlanEntry[];
  billingPeriods: BillingPeriod[];
  dayStates: DayState[];
  devItems: DevItem[];

  openTask: (taskId: string | null) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  addTask: (clientId: string, sectionId: string | null, title: string) => void;
  /** Hard-delete a task. CASCADES to its time entries — confirm with the user first. */
  deleteTask: (taskId: string) => void;
  addSection: (clientId: string, name: string) => void;
  updateSection: (sectionId: string, patch: Partial<Pick<Section, "name">>) => void;
  /** No-ops (with a visible write error) if the section still contains tasks. */
  deleteSection: (sectionId: string) => void;
  /** Move `movedId` before `beforeId` within its own section; null = to the end. */
  reorderTask: (movedId: string, beforeId: string | null) => void;
  addClient: (name: string, color: string, billingPeriodNote?: string) => Promise<Client | null>;
  patchProfileLocal: (profileId: string, patch: Partial<Profile>) => void;
  updateProfile: (profileId: string, patch: Partial<Profile>) => void;
  updateClient: (clientId: string, patch: Partial<Client>) => void;
  addTag: (name: string, color: string) => void;
  updateTag: (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => void;
  deleteTag: (tagId: string) => void;
  addPlanEntry: (input: NewPlanEntry) => void;
  movePlanEntry: (entryId: string, target: { date: string | null; columnId: string }) => void;
  deletePlanEntry: (entryId: string) => void;
  addPlanColumn: (name: string) => void;
  updatePlanColumn: (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => void;
  movePlanColumn: (columnId: string, direction: -1 | 1) => void;
  deletePlanColumn: (columnId: string) => void;
  addComment: (taskId: string, body: string) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  addTimeEntry: (taskId: string, minutes: number, description: string, date?: string, userId?: string) => void;
  updateTimeEntry: (entryId: string, patch: { minutes?: number; description?: string; date?: string }) => void;
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
}

interface HistoryAction {
  undo: () => void;
  redo: () => void;
}

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
  const [entrySums, setEntrySums] = useState<EntrySum[]>([]);
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
  const [openSyncIssues, setOpenSyncIssues] = useState(0);
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
  const noteWriteError = useCallback((label: string, error: { message: string }) => {
    console.error(`${label} failed`, error.message);
    setWriteError("Some changes couldn't be saved. Reload to get the latest from the server.");
  }, []);

  // ── undo / redo history (last 10 data actions) ────────────────────────
  const historyRef = useRef<{ past: HistoryAction[]; future: HistoryAction[] }>({ past: [], future: [] });
  const suppressHistory = useRef(false);
  /** Latest mutation methods, so history actions never call stale closures. */
  const methodsRef = useRef<Store | null>(null);
  const record = useCallback((action: HistoryAction) => {
    if (suppressHistory.current) return;
    historyRef.current.past.push(action);
    if (historyRef.current.past.length > 10) historyRef.current.past.shift();
    historyRef.current.future = [];
  }, []);
  const undo = useCallback(() => {
    const action = historyRef.current.past.pop();
    if (!action) return;
    suppressHistory.current = true;
    try {
      action.undo();
    } finally {
      suppressHistory.current = false;
    }
    historyRef.current.future.push(action);
  }, []);
  const redo = useCallback(() => {
    const action = historyRef.current.future.pop();
    if (!action) return;
    suppressHistory.current = true;
    try {
      action.redo();
    } finally {
      suppressHistory.current = false;
    }
    historyRef.current.past.push(action);
  }, []);

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

  const minutesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entrySums) map.set(e.taskId, (map.get(e.taskId) ?? 0) + e.minutes);
    return map;
  }, [entrySums]);

  // ── initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        window.location.href = "/login";
        return;
      }

      const tagsP = supabase.from("tags").select("*").order("position");
      const [prof, cli, projLegacy, sec, tagsRes, cols, pe, taskRows, sums, feed, openIssues, requests, periods, days, dev] =
        await Promise.all([
          // "*" keeps boot working whether or not migration 0004 is applied
          fetchAll<DbRow>(supabase, "profiles", "*"),
          fetchAll<DbRow>(supabase, "clients", "*"),
          // legacy layer: only used to derive client_id before migration 0007
          fetchAll<DbRow>(supabase, "projects", "id, client_id"),
          // "*" tolerates pre-0007 schema (no client_id column yet)
          fetchAll<DbRow>(supabase, "sections", "*"),
          tagsP,
          fetchAll<DbRow>(supabase, "plan_columns", "*"),
          fetchAll<DbRow>(supabase, "plan_entries", "*"),
          (async () => {
            const cols =
              "id, project_id, section_id, title, figma_url, status, tag_id, assignee_id, due_date, billable, estimate_hours, position, pending";
            try {
              // post-0007 schema
              return await fetchAll<DbRow>(supabase, "tasks", `client_id, ${cols}`);
            } catch {
              return await fetchAll<DbRow>(supabase, "tasks", cols);
            }
          })(),
          fetchAll<DbRow>(supabase, "time_entries", "id, task_id, user_id, date, minutes", (q) =>
            q.not("minutes", "is", null),
          ),
          supabase
            .from("time_entries")
            .select("*")
            .not("minutes", "is", null)
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(400),
          // Open Everhour sync gaps, for the header notification bell.
          // Admin-only via RLS (0 for designers); 0 too if 0014 isn't applied yet.
          (async () => {
            const { count, error } = await supabase
              .from("sync_issues")
              .select("id", { count: "exact", head: true })
              .eq("status", "open");
            return error ? 0 : (count ?? 0);
          })(),
          // Returns [] for designers (RLS: admins only)
          supabase.from("task_requests").select("*").order("created_at", { ascending: false }),
          // pre-0007 these tables don't exist; RLS hides them from designers
          fetchAll<DbRow>(supabase, "client_billing_periods", "*").catch(() => []),
          fetchAll<DbRow>(supabase, "plan_day_states", "*").catch(() => []),
          fetchAll<DbRow>(supabase, "dev_items", "*").catch(() => []),
        ]);

      if (cancelled) return;

      const tagList = ((tagsRes.data ?? []) as DbRow[]).map(mapTag);
      const tagMap = new Map(tagList.map((t) => [t.id, t.name]));
      const projectClient = new Map<string, string>(
        projLegacy.map((p) => [p.id as string, p.client_id as string]),
      );

      setCurrentUserId(uid);
      setProfiles(prof.map(mapProfile));
      setClients(cli.map(mapClient));
      setSections(sec.map((r) => mapSection(r, projectClient)));
      setTagRows(tagList);
      setTasks(taskRows.map((r) => mapTask({ ...r, brief: undefined }, tagMap, projectClient)));
      setBillingPeriods(periods.map(mapBillingPeriod).sort((a: BillingPeriod, b: BillingPeriod) => a.dateFrom.localeCompare(b.dateFrom)));
      setDayStates(days.map(mapDayState));
      setDevItems(dev.map(mapDevItem).sort((a: DevItem, b: DevItem) => a.position - b.position));
      setEntrySums(sums.map(mapEntrySum));
      setTimeEntries((feed.data ?? []).map(mapTimeEntry));
      setPlanColumns(cols.map(mapPlanColumn));
      setPlanEntries(pe.map(mapPlanEntry));
      setOpenSyncIssues(openIssues);
      setTaskRequests(((requests.data ?? []) as DbRow[]).map(mapTaskRequest));
      setLoading(false);
    })().catch((e) => {
      console.error("store load failed", e);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ── lazy per-task detail (brief, comments, full entries) ─────────────
  const openTask = useCallback(
    (taskId: string | null) => {
      setOpenTaskId(taskId);
      if (!taskId || loadedTaskExtras.current.has(taskId)) return;
      loadedTaskExtras.current.add(taskId);
      (async () => {
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
          setAttachments((prev) => {
            const seen = new Set(prev.map((a) => a.id));
            const mapped = (atts.data as DbRow[])
              .filter((a) => !seen.has(a.id as string))
              .map((a) => ({
                id: a.id as string,
                taskId: a.task_id as string,
                fileName: a.file_name as string,
                filePath: a.file_path as string,
                sizeBytes: a.size_bytes as number,
                uploadedBy: a.uploaded_by as string,
              }));
            return [...prev, ...mapped];
          });
        }
        if (detail.data) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, brief: detail.data.brief ?? "" } : t)),
          );
        }
        if (cm.data) {
          setComments((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...(cm.data as DbRow[]).filter((c) => !seen.has(c.id as string)).map(mapComment)];
          });
        }
        if (entries.data) {
          setTimeEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...(entries.data as DbRow[]).filter((e) => !seen.has(e.id as string)).map(mapTimeEntry)];
          });
        }
      })().catch((e) => console.error("task detail load failed", e));
    },
    [supabase],
  );

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
        .then(({ error }) => {
          if (error) noteWriteError("updateTask", error);
        });
    },
    [supabase, tagIdByName, tasks, record],
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
    [supabase, tasks, tagNameById, clients],
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
    [supabase, sections],
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
        .then(({ error }) => {
          if (error) noteWriteError("deleteTask", error);
        });
    },
    [supabase],
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
        .then(({ error }) => {
          if (error) noteWriteError("updateSection", error);
        });
    },
    [supabase, sections, record],
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
        .then(({ error }) => {
          if (error) noteWriteError("deleteSection", error);
        });
    },
    [supabase, tasks],
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
              .then(({ error }) => error && noteWriteError("reorderTask undo", error));
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
          .then(({ error }) => error && noteWriteError("reorderTask", error));
      }
    },
    [supabase, tasks, record],
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
    [supabase],
  );

  const patchProfileLocal = useCallback((profileId: string, patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
  }, []);

  const updateProfile = useCallback(
    (profileId: string, patch: Partial<Profile>) => {
      const before = profiles.find((p) => p.id === profileId);
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
      if ("capacityHoursWeek" in patch) row.capacity_hours_week = patch.capacityHoursWeek;
      supabase
        .from("profiles")
        .update(row)
        .eq("id", profileId)
        .then(({ error }) => {
          if (error) noteWriteError("updateProfile", error);
        });
    },
    [supabase, profiles, record],
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
    [supabase, tagRows],
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
        .then(({ error }) => {
          if (error) noteWriteError("updateTag", error);
        });
    },
    [supabase, tagRows, record],
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
        .then(({ error }) => {
          if (error) noteWriteError("deleteTag", error);
        });
    },
    [supabase, tagRows],
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
        .then(({ error }) => {
          if (error) noteWriteError("updateClient", error);
        });
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
          .then(({ error }) => {
            if (error) noteWriteError("updateClient tasks-billable", error);
          });
      }
    },
    [supabase, clients, record],
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
        .then(({ error }) => {
          if (error) noteWriteError("restorePlanEntry", error);
        });
    },
    [supabase],
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
    [supabase, planEntries, record, restorePlanEntry],
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
        .then(({ error }) => {
          if (error) noteWriteError("movePlanEntry", error);
        });
    },
    [supabase, planEntries, record],
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
        .then(({ error }) => {
          if (error) noteWriteError("deletePlanEntry", error);
        });
    },
    [supabase, planEntries, record, restorePlanEntry],
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
    [supabase, planColumns],
  );

  const updatePlanColumn = useCallback(
    (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => {
      const prev = planColumns;
      setPlanColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, ...patch } : c)));
      supabase
        .from("plan_columns")
        .update(patch)
        .eq("id", columnId)
        .then(({ error }) => {
          if (error) {
            noteWriteError("updatePlanColumn", error);
            setPlanColumns(prev); // e.g. `hidden` migration not applied yet
          }
        });
    },
    [supabase, planColumns],
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
        .then(({ error }) => {
          if (error) noteWriteError("movePlanColumn", error);
        });
      supabase
        .from("plan_columns")
        .update({ position: a.position })
        .eq("id", swapWith.id)
        .then(({ error }) => {
          if (error) noteWriteError("movePlanColumn", error);
        });
    },
    [supabase, planColumns],
  );

  const deletePlanColumn = useCallback(
    (columnId: string) => {
      setPlanColumns((prev) => prev.filter((c) => c.id !== columnId));
      setPlanEntries((prev) => prev.filter((e) => e.columnId !== columnId));
      supabase
        .from("plan_columns")
        .delete()
        .eq("id", columnId)
        .then(({ error }) => {
          if (error) noteWriteError("deletePlanColumn", error);
        });
    },
    [supabase],
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
    [supabase, currentUserId],
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
      },
      ...prev.filter((e) => e.id !== entry.id),
    ]);
  }, []);

  /** Re-insert a deleted time entry with its original id (undo support). */
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
        })
        .then(({ error }) => {
          if (error) noteWriteError("restoreTimeEntry", error);
        });
    },
    [supabase, applyEntryLocally],
  );

  const addTimeEntry = useCallback(
    (taskId: string, minutes: number, description: string, date?: string, userId?: string) => {
      supabase
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
        .single()
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTimeEntry", error);
            return;
          }
          const entry = mapTimeEntry(data);
          applyEntryLocally(entry);
          record({
            undo: () => methodsRef.current?.deleteTimeEntry(entry.id),
            redo: () => restoreTimeEntry(entry),
          });
        });
    },
    [supabase, currentUserId, applyEntryLocally, record, restoreTimeEntry],
  );

  const updateTimeEntry = useCallback(
    (entryId: string, patch: { minutes?: number; description?: string; date?: string }) => {
      // full row if loaded; the slim sums row covers minutes/date-only patches
      const before =
        timeEntries.find((e) => e.id === entryId) ??
        ("description" in patch ? undefined : entrySums.find((e) => e.id === entryId));
      if (before) {
        const prev: typeof patch = {};
        if ("minutes" in patch) prev.minutes = before.minutes;
        if ("date" in patch) prev.date = before.date;
        if ("description" in patch) prev.description = (before as TimeEntry).description;
        record({
          undo: () => methodsRef.current?.updateTimeEntry(entryId, prev),
          redo: () => methodsRef.current?.updateTimeEntry(entryId, patch),
        });
      }
      setTimeEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
      if (patch.minutes != null || patch.date != null) {
        setEntrySums((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, ...(patch.minutes != null && { minutes: patch.minutes }), ...(patch.date != null && { date: patch.date }) }
              : e,
          ),
        );
      }
      supabase
        .from("time_entries")
        .update(patch)
        .eq("id", entryId)
        .then(({ error }) => {
          if (error) noteWriteError("updateTimeEntry", error);
        });
    },
    [supabase, timeEntries, entrySums, record],
  );

  const deleteTimeEntry = useCallback(
    (entryId: string) => {
      const full = timeEntries.find((e) => e.id === entryId);
      const slim = entrySums.find((e) => e.id === entryId);
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
        .then(({ error }) => {
          if (error) noteWriteError("deleteTimeEntry", error);
        });
    },
    [supabase, timeEntries, entrySums, record, restoreTimeEntry],
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
        .then(({ error }) => {
          if (error) noteWriteError("restoreBillingPeriod", error);
        });
    },
    [supabase],
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
    [supabase, billingPeriods, record, restoreBillingPeriod],
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
        .then(({ error }) => {
          if (error) noteWriteError("updateBillingPeriod", error);
        });
    },
    [supabase, billingPeriods, record],
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
        .then(({ error }) => {
          if (error) noteWriteError("deleteBillingPeriod", error);
        });
    },
    [supabase, billingPeriods, record, restoreBillingPeriod],
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
    [supabase, currentUserId],
  );

  const deleteDayState = useCallback(
    (id: string) => {
      setDayStates((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("plan_day_states")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) noteWriteError("deleteDayState", error);
        });
    },
    [supabase],
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
    [supabase, devItems],
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
        .then(({ error }) => {
          if (error) noteWriteError("updateDevItem", error);
        });
    },
    [supabase, devItems, record],
  );

  const deleteDevItem = useCallback(
    (id: string) => {
      setDevItems((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("dev_items")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) noteWriteError("deleteDevItem", error);
        });
    },
    [supabase],
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
        .then(({ error }) => {
          if (error) noteWriteError("moveTimeEntries", error);
        });
    },
    [supabase, currentUserId],
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
    [supabase, taskRequests, tagNameById, clients],
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
        .then(({ error }) => {
          if (error) noteWriteError("rejectRequest", error);
        });
    },
    [supabase],
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
      currentUserId: viewAsProfile ? viewAsProfile.id : currentUserId,
      viewingAs: viewAsProfile ? viewAsProfile.name : null,
      openSyncIssues,
      openTaskId,
      planColumns,
      planEntries,
      billingPeriods,
      dayStates,
      devItems,
      openTask,
      updateTask,
      addTask,
      deleteTask,
      addSection,
      updateSection,
      deleteSection,
      reorderTask,
      addClient,
      patchProfileLocal,
      updateProfile,
      updateClient,
      addTag,
      updateTag,
      deleteTag,
      addPlanEntry,
      movePlanEntry,
      deletePlanEntry,
      addPlanColumn,
      updatePlanColumn,
      movePlanColumn,
      deletePlanColumn,
      addComment,
      addAttachment,
      removeAttachment,
      addTimeEntry,
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
    }),
    [
      loading, profiles, clients, sections, tagRows, tasks, comments, attachments, timeEntries, entrySums,
      currentUserId, viewAsProfile, openSyncIssues, openTaskId, planColumns, planEntries, billingPeriods, dayStates, devItems,
      openTask, updateTask, addTask, deleteTask, addSection, updateSection, deleteSection, reorderTask, addClient, patchProfileLocal, updateProfile, updateClient, addTag, updateTag, deleteTag, addPlanEntry, movePlanEntry, deletePlanEntry, addPlanColumn, updatePlanColumn, movePlanColumn, deletePlanColumn, addComment, addAttachment, removeAttachment, addTimeEntry, updateTimeEntry, deleteTimeEntry, moveTimeEntries, addBillingPeriod, updateBillingPeriod, deleteBillingPeriod, addDayState, deleteDayState, addDevItem, updateDevItem, deleteDevItem, taskRequests, approveRequest, rejectRequest, taskMinutes, undo, redo, writeError, dismissWriteError,
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
