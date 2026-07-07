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
  mapClient,
  mapComment,
  mapPlanColumn,
  mapPlanEntry,
  mapProfile,
  mapProject,
  mapSection,
  mapTask,
  mapTimeEntry,
  taskPatchToRow,
} from "./db";
import { toISODate } from "./format";
import type {
  AbsenceType,
  Attachment,
  Client,
  PlanColumn,
  PlanEntry,
  PlanEntryType,
  Profile,
  Project,
  Section,
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
  projectId: string;
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
  projects: Project[];
  sections: Section[];
  tags: string[];
  tasks: Task[];
  comments: TaskComment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  currentUserId: string;
  runningTimer: RunningTimer | null;
  openTaskId: string | null;
  planColumns: PlanColumn[];
  planEntries: PlanEntry[];

  openTask: (taskId: string | null) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  addTask: (projectId: string, sectionId: string | null, title: string) => void;
  addSection: (projectId: string, name: string) => void;
  patchProfileLocal: (profileId: string, patch: Partial<Profile>) => void;
  updateClient: (clientId: string, patch: Partial<Client>) => void;
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
  moveTimeEntries: (entryIds: string[], fromTaskId: string, toTaskId: string) => void;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [tagRows, setTagRows] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [minutesByTask, setMinutesByTask] = useState<Map<string, number>>(new Map());
  const [planColumns, setPlanColumns] = useState<PlanColumn[]>([]);
  const [planEntries, setPlanEntries] = useState<PlanEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [runningTimer, setRunningTimer] = useState<RunningTimer | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [taskRequests, setTaskRequests] = useState<TaskRequest[]>([]);
  const loadedTaskExtras = useRef<Set<string>>(new Set());

  const tagNameById = useMemo(() => new Map(tagRows.map((t) => [t.id, t.name])), [tagRows]);
  const tagIdByName = useMemo(() => new Map(tagRows.map((t) => [t.name, t.id])), [tagRows]);

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

      const tagsP = supabase.from("tags").select("id, name").order("position");
      const [prof, cli, proj, sec, tagsRes, cols, pe, taskRows, sums, feed, running, requests] =
        await Promise.all([
          fetchAll<any>(supabase, "profiles", "id, name, role, avatar_url, active"),
          fetchAll<any>(supabase, "clients", "id, name, color, billing_period_note, archived"),
          fetchAll<any>(supabase, "projects", "id, client_id, name, billable, archived"),
          fetchAll<any>(supabase, "sections", "id, project_id, name, position"),
          tagsP,
          fetchAll<any>(supabase, "plan_columns", "*"),
          fetchAll<any>(supabase, "plan_entries", "*"),
          fetchAll<any>(
            supabase,
            "tasks",
            "id, project_id, section_id, title, figma_url, status, tag_id, assignee_id, due_date, billable, estimate_hours, position, pending",
          ),
          fetchAll<any>(supabase, "time_entries", "task_id, minutes", (q) =>
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
        ]);

      if (cancelled) return;

      const tagList = (tagsRes.data ?? []) as { id: string; name: string }[];
      const tagMap = new Map(tagList.map((t) => [t.id, t.name]));

      const sumMap = new Map<string, number>();
      for (const r of sums) {
        sumMap.set(r.task_id, (sumMap.get(r.task_id) ?? 0) + (r.minutes ?? 0));
      }

      setCurrentUserId(uid);
      setProfiles(prof.map(mapProfile));
      setClients(cli.map(mapClient));
      setProjects(proj.map(mapProject));
      setSections(sec.map(mapSection));
      setTagRows(tagList);
      setTasks(taskRows.map((r) => mapTask({ ...r, brief: undefined }, tagMap)));
      setMinutesByTask(sumMap);
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
    (projectId: string, sectionId: string | null, title: string) => {
      const project = projects.find((p) => p.id === projectId);
      const position =
        Math.max(0, ...tasks.filter((t) => t.projectId === projectId).map((t) => t.position)) + 1;
      supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          section_id: sectionId,
          title,
          billable: project?.billable ?? true,
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
    [supabase, projects, tasks, tagNameById],
  );

  const addSection = useCallback(
    (projectId: string, name: string) => {
      const position =
        Math.max(0, ...sections.filter((s) => s.projectId === projectId).map((s) => s.position)) + 1;
      supabase
        .from("sections")
        .insert({ project_id: projectId, name, position })
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

  const patchProfileLocal = useCallback((profileId: string, patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
  }, []);

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
    setMinutesByTask((prev) => {
      const next = new Map(prev);
      next.set(entry.taskId, (next.get(entry.taskId) ?? 0) + entry.minutes);
      return next;
    });
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

  const moveTimeEntries = useCallback(
    (entryIds: string[], fromTaskId: string, toTaskId: string) => {
      const idSet = new Set(entryIds);
      let movedMinutes = 0;
      setTimeEntries((prev) =>
        prev.map((e) => {
          if (!idSet.has(e.id)) return e;
          movedMinutes += e.minutes;
          return { ...e, taskId: toTaskId, movedFromTaskId: fromTaskId };
        }),
      );
      setMinutesByTask((prev) => {
        const moved = timeEntries
          .filter((e) => idSet.has(e.id))
          .reduce((s, e) => s + e.minutes, 0);
        const next = new Map(prev);
        next.set(fromTaskId, Math.max(0, (next.get(fromTaskId) ?? 0) - moved));
        next.set(toTaskId, (next.get(toTaskId) ?? 0) + moved);
        return next;
      });
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
    [supabase, currentUserId, timeEntries],
  );

  const approveRequest = useCallback(
    async (requestId: string, input: ApproveRequestInput) => {
      const request = taskRequests.find((r) => r.id === requestId);
      if (!request) return;
      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          project_id: input.projectId,
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
      projects,
      sections,
      tags: tagRows.map((t) => t.name),
      tasks,
      comments,
      attachments,
      timeEntries,
      currentUserId,
      runningTimer,
      openTaskId,
      planColumns,
      planEntries,
      openTask,
      updateTask,
      addTask,
      addSection,
      patchProfileLocal,
      updateClient,
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
      moveTimeEntries,
      taskRequests,
      approveRequest,
      rejectRequest,
      startTimer,
      stopTimer,
      completeTimerEntry,
      taskMinutes,
    }),
    [
      loading, profiles, clients, projects, sections, tagRows, tasks, comments, attachments, timeEntries,
      currentUserId, runningTimer, openTaskId, planColumns, planEntries,
      openTask, updateTask, addTask, addSection, patchProfileLocal, updateClient, addPlanEntry, movePlanEntry, deletePlanEntry, addPlanColumn, updatePlanColumn, movePlanColumn, deletePlanColumn, addComment, addAttachment, removeAttachment, addTimeEntry, moveTimeEntries, taskRequests, approveRequest, rejectRequest, startTimer, stopTimer, completeTimerEntry, taskMinutes,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useData(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useData must be used inside DataProvider");
  return store;
}
