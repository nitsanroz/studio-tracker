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

interface RunningTimer {
  entryId: string;
  taskId: string;
  startedAt: number; // epoch ms
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
  runningTimer: RunningTimer | null;
  openTaskId: string | null;
  planColumns: PlanColumn[];
  planEntries: PlanEntry[];
  billingPeriods: BillingPeriod[];
  dayStates: DayState[];
  devItems: DevItem[];

  openTask: (taskId: string | null) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  addTask: (clientId: string, sectionId: string | null, title: string) => void;
  addSection: (clientId: string, name: string) => void;
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
  addTimeEntry: (taskId: string, minutes: number, description: string, date?: string) => void;
  updateTimeEntry: (entryId: string, patch: { minutes?: number; description?: string; date?: string }) => void;
  deleteTimeEntry: (entryId: string) => void;
  moveTimeEntries: (entryIds: string[], fromTaskId: string, toTaskId: string) => void;
  addBillingPeriod: (input: Omit<BillingPeriod, "id" | "position">) => void;
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
  startTimer: (taskId: string) => void;
  /** Stops ticking and returns the pending entry; caller must completeTimerEntry with a description. */
  stopTimer: () => { entryId: string; taskId: string; minutes: number } | null;
  completeTimerEntry: (entryId: string, taskId: string, minutes: number, description: string) => void;
  taskMinutes: (taskId: string) => number;
}

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
  const [runningTimer, setRunningTimer] = useState<RunningTimer | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [taskRequests, setTaskRequests] = useState<TaskRequest[]>([]);
  const loadedTaskExtras = useRef<Set<string>>(new Set());

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
      const [prof, cli, projLegacy, sec, tagsRes, cols, pe, taskRows, sums, feed, running, requests, periods, days, dev] =
        await Promise.all([
          // "*" keeps boot working whether or not migration 0004 is applied
          fetchAll<any>(supabase, "profiles", "*"),
          fetchAll<any>(supabase, "clients", "id, name, color, billing_period_note, archived"),
          // legacy layer: only used to derive client_id before migration 0007
          fetchAll<any>(supabase, "projects", "id, client_id"),
          // "*" tolerates pre-0007 schema (no client_id column yet)
          fetchAll<any>(supabase, "sections", "*"),
          tagsP,
          fetchAll<any>(supabase, "plan_columns", "*"),
          fetchAll<any>(supabase, "plan_entries", "*"),
          (async () => {
            const cols =
              "id, project_id, section_id, title, figma_url, status, tag_id, assignee_id, due_date, billable, estimate_hours, position, pending";
            try {
              // post-0007 schema
              return await fetchAll<any>(supabase, "tasks", `client_id, ${cols}`);
            } catch {
              return await fetchAll<any>(supabase, "tasks", cols);
            }
          })(),
          fetchAll<any>(supabase, "time_entries", "id, task_id, user_id, date, minutes", (q) =>
            q.not("minutes", "is", null),
          ),
          supabase
            .from("time_entries")
            .select("*")
            .not("minutes", "is", null)
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(400),
          supabase
            .from("time_entries")
            .select("id, task_id, started_at")
            .eq("user_id", uid)
            .is("minutes", null)
            .maybeSingle(),
          // Returns [] for designers (RLS: admins only)
          supabase.from("task_requests").select("*").order("created_at", { ascending: false }),
          // pre-0007 these tables don't exist; RLS hides them from designers
          fetchAll<any>(supabase, "client_billing_periods", "*").catch(() => []),
          fetchAll<any>(supabase, "plan_day_states", "*").catch(() => []),
          fetchAll<any>(supabase, "dev_items", "*").catch(() => []),
        ]);

      if (cancelled) return;

      const tagList = ((tagsRes.data ?? []) as any[]).map(mapTag);
      const tagMap = new Map(tagList.map((t) => [t.id, t.name]));
      const projectClient = new Map<string, string>(
        projLegacy.map((p: any) => [p.id, p.client_id]),
      );

      setCurrentUserId(uid);
      setProfiles(prof.map(mapProfile));
      setClients(cli.map(mapClient));
      setSections(sec.map((r) => mapSection(r, projectClient)));
      setTagRows(tagList);
      setTasks(taskRows.map((r: any) => mapTask({ ...r, brief: undefined }, tagMap, projectClient)));
      setBillingPeriods(periods.map(mapBillingPeriod).sort((a: BillingPeriod, b: BillingPeriod) => a.dateFrom.localeCompare(b.dateFrom)));
      setDayStates(days.map(mapDayState));
      setDevItems(dev.map(mapDevItem).sort((a: DevItem, b: DevItem) => a.position - b.position));
      setEntrySums(sums.map(mapEntrySum));
      setTimeEntries((feed.data ?? []).map(mapTimeEntry));
      setPlanColumns(cols.map(mapPlanColumn));
      setPlanEntries(pe.map(mapPlanEntry));
      if (running.data) {
        setRunningTimer({
          entryId: running.data.id,
          taskId: running.data.task_id,
          startedAt: new Date(running.data.started_at).getTime(),
        });
      }
      setTaskRequests(((requests.data as any[]) ?? []).map(mapTaskRequest));
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
            const mapped = atts.data
              .filter((a: any) => !seen.has(a.id))
              .map((a: any) => ({
                id: a.id,
                taskId: a.task_id,
                fileName: a.file_name,
                filePath: a.file_path,
                sizeBytes: a.size_bytes,
                uploadedBy: a.uploaded_by,
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
            return [...prev, ...cm.data.filter((c: any) => !seen.has(c.id)).map(mapComment)];
          });
        }
        if (entries.data) {
          setTimeEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...entries.data.filter((e: any) => !seen.has(e.id)).map(mapTimeEntry)];
          });
        }
      })().catch((e) => console.error("task detail load failed", e));
    },
    [supabase],
  );

  // ── mutations ─────────────────────────────────────────────────────────
  const updateTask = useCallback(
    (taskId: string, patch: Partial<Task>) => {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
      supabase
        .from("tasks")
        .update(taskPatchToRow(patch, tagIdByName))
        .eq("id", taskId)
        .then(({ error }) => {
          if (error) console.error("updateTask failed", error.message);
        });
    },
    [supabase, tagIdByName],
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
          billable: true,
          position,
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error("addTask failed", error.message);
            return;
          }
          setTasks((prev) => [...prev, mapTask(data, tagNameById)]);
        });
    },
    [supabase, tasks, tagNameById],
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
            console.error("addSection failed", error.message);
            return;
          }
          setSections((prev) => [...prev, mapSection(data)]);
        });
    },
    [supabase, sections],
  );

  const addClient = useCallback(
    async (name: string, color: string, billingPeriodNote?: string): Promise<Client | null> => {
      const { data, error } = await supabase
        .from("clients")
        .insert({ name, color, billing_period_note: billingPeriodNote ?? "" })
        .select()
        .single();
      if (error) {
        console.error("addClient failed", error.message);
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
          if (error) console.error("updateProfile failed", error.message);
        });
    },
    [supabase],
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
            console.error("addTag failed", error.message);
            return;
          }
          setTagRows((prev) => [...prev, mapTag(data)]);
        });
    },
    [supabase, tagRows],
  );

  const updateTag = useCallback(
    (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => {
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
          if (error) console.error("updateTag failed", error.message);
        });
    },
    [supabase, tagRows],
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
          if (error) console.error("deleteTag failed", error.message);
        });
    },
    [supabase, tagRows],
  );

  const updateClient = useCallback(
    (clientId: string, patch: Partial<Client>) => {
      setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...patch } : c)));
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("color" in patch) row.color = patch.color;
      if ("archived" in patch) row.archived = patch.archived;
      if ("billingPeriodNote" in patch) row.billing_period_note = patch.billingPeriodNote;
      supabase
        .from("clients")
        .update(row)
        .eq("id", clientId)
        .then(({ error }) => {
          if (error) console.error("updateClient failed", error.message);
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
            console.error("addPlanEntry failed", error.message);
            return;
          }
          setPlanEntries((prev) => [...prev, mapPlanEntry(data)]);
        });
    },
    [supabase, planEntries],
  );

  const movePlanEntry = useCallback(
    (entryId: string, target: { date: string | null; columnId: string }) => {
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
          if (error) console.error("movePlanEntry failed", error.message);
        });
    },
    [supabase, planEntries],
  );

  const deletePlanEntry = useCallback(
    (entryId: string) => {
      setPlanEntries((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("plan_entries")
        .delete()
        .eq("id", entryId)
        .then(({ error }) => {
          if (error) console.error("deletePlanEntry failed", error.message);
        });
    },
    [supabase],
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
            console.error("addPlanColumn failed", error.message);
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
            console.error("updatePlanColumn failed", error.message);
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
      supabase.from("plan_columns").update({ position: swapWith.position }).eq("id", a.id).then(() => {});
      supabase.from("plan_columns").update({ position: a.position }).eq("id", swapWith.id).then(() => {});
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
          if (error) console.error("deletePlanColumn failed", error.message);
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
            console.error("addComment failed", error.message);
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

  const addTimeEntry = useCallback(
    (taskId: string, minutes: number, description: string, date?: string) => {
      supabase
        .from("time_entries")
        .insert({
          task_id: taskId,
          user_id: currentUserId,
          date: date ?? toISODate(new Date()),
          minutes,
          description,
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error("addTimeEntry failed", error.message);
            return;
          }
          applyEntryLocally(mapTimeEntry(data));
        });
    },
    [supabase, currentUserId, applyEntryLocally],
  );

  const updateTimeEntry = useCallback(
    (entryId: string, patch: { minutes?: number; description?: string; date?: string }) => {
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
          if (error) console.error("updateTimeEntry failed", error.message);
        });
    },
    [supabase],
  );

  const deleteTimeEntry = useCallback(
    (entryId: string) => {
      setTimeEntries((prev) => prev.filter((e) => e.id !== entryId));
      setEntrySums((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("time_entries")
        .delete()
        .eq("id", entryId)
        .then(({ error }) => {
          if (error) console.error("deleteTimeEntry failed", error.message);
        });
    },
    [supabase],
  );

  const addBillingPeriod = useCallback(
    (input: Omit<BillingPeriod, "id" | "position">) => {
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
            console.error("addBillingPeriod failed", error.message);
            return;
          }
          setBillingPeriods((prev) =>
            [...prev, mapBillingPeriod(data)].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
          );
        });
    },
    [supabase, billingPeriods],
  );

  const updateBillingPeriod = useCallback(
    (id: string, patch: Partial<BillingPeriod>) => {
      setBillingPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      const row: Record<string, unknown> = {};
      if ("label" in patch) row.label = patch.label;
      if ("dateFrom" in patch) row.date_from = patch.dateFrom;
      if ("dateTo" in patch) row.date_to = patch.dateTo;
      if ("hourCap" in patch) row.hour_cap = patch.hourCap;
      if ("advanceHours" in patch) row.advance_hours = patch.advanceHours;
      supabase
        .from("client_billing_periods")
        .update(row)
        .eq("id", id)
        .then(({ error }) => {
          if (error) console.error("updateBillingPeriod failed", error.message);
        });
    },
    [supabase],
  );

  const deleteBillingPeriod = useCallback(
    (id: string) => {
      setBillingPeriods((prev) => prev.filter((p) => p.id !== id));
      supabase
        .from("client_billing_periods")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) console.error("deleteBillingPeriod failed", error.message);
        });
    },
    [supabase],
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
            console.error("addDayState failed", error.message);
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
          if (error) console.error("deleteDayState failed", error.message);
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
            console.error("addDevItem failed", error.message);
            return;
          }
          setDevItems((prev) => [...prev, mapDevItem(data)]);
        });
    },
    [supabase, devItems],
  );

  const updateDevItem = useCallback(
    (id: string, patch: { text?: string; status?: DevStatus }) => {
      setDevItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
      supabase
        .from("dev_items")
        .update(patch)
        .eq("id", id)
        .then(({ error }) => {
          if (error) console.error("updateDevItem failed", error.message);
        });
    },
    [supabase],
  );

  const deleteDevItem = useCallback(
    (id: string) => {
      setDevItems((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("dev_items")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) console.error("deleteDevItem failed", error.message);
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
          if (error) console.error("moveTimeEntries failed", error.message);
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
          billable: true,
          estimate_hours: input.estimateHours,
        })
        .select()
        .single();
      if (error) {
        console.error("approveRequest failed", error.message);
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
    [supabase, taskRequests, tagNameById],
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
          if (error) console.error("rejectRequest failed", error.message);
        });
    },
    [supabase],
  );

  const startTimer = useCallback(
    (taskId: string) => {
      const startedAt = Date.now();
      supabase
        .from("time_entries")
        .insert({
          task_id: taskId,
          user_id: currentUserId,
          date: toISODate(new Date()),
          minutes: null,
          description: "",
          started_at: new Date(startedAt).toISOString(),
        })
        .select("id")
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error("startTimer failed", error.message);
            return;
          }
          setRunningTimer({ entryId: data.id, taskId, startedAt });
        });
    },
    [supabase, currentUserId],
  );

  const stopTimer = useCallback(() => {
    if (!runningTimer) return null;
    const minutes = Math.max(1, Math.round((Date.now() - runningTimer.startedAt) / 60000));
    const result = { entryId: runningTimer.entryId, taskId: runningTimer.taskId, minutes };
    setRunningTimer(null);
    return result;
  }, [runningTimer]);

  const completeTimerEntry = useCallback(
    (entryId: string, taskId: string, minutes: number, description: string) => {
      supabase
        .from("time_entries")
        .update({ minutes, description, date: toISODate(new Date()) })
        .eq("id", entryId)
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error("completeTimerEntry failed", error.message);
            return;
          }
          applyEntryLocally(mapTimeEntry(data));
        });
    },
    [supabase, applyEntryLocally],
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
      currentUserId,
      runningTimer,
      openTaskId,
      planColumns,
      planEntries,
      billingPeriods,
      dayStates,
      devItems,
      openTask,
      updateTask,
      addTask,
      addSection,
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
      startTimer,
      stopTimer,
      completeTimerEntry,
      taskMinutes,
    }),
    [
      loading, profiles, clients, sections, tagRows, tasks, comments, attachments, timeEntries, entrySums,
      currentUserId, runningTimer, openTaskId, planColumns, planEntries, billingPeriods, dayStates, devItems,
      openTask, updateTask, addTask, addSection, addClient, patchProfileLocal, updateProfile, updateClient, addTag, updateTag, deleteTag, addPlanEntry, movePlanEntry, deletePlanEntry, addPlanColumn, updatePlanColumn, movePlanColumn, deletePlanColumn, addComment, addAttachment, removeAttachment, addTimeEntry, updateTimeEntry, deleteTimeEntry, moveTimeEntries, addBillingPeriod, updateBillingPeriod, deleteBillingPeriod, addDayState, deleteDayState, addDevItem, updateDevItem, deleteDevItem, taskRequests, approveRequest, rejectRequest, startTimer, stopTimer, completeTimerEntry, taskMinutes,
    ],
  );

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
