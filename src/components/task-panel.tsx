"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useEnterTransition } from "@/lib/use-enter-transition";
import { formatDate, formatDayMonth, formatHours, formatHoursDecimal } from "@/lib/format";
import { taskMinutesDone, taskLegacyMinutes } from "@/lib/task-hours";
import { formatSize } from "@/lib/uploads";
import { Avatar, BudgetBar, ClientChip, TagBadge } from "./ui";
import { EditableTextCell } from "./editable-cell";
import { TimeEntryModal, canEditEntry } from "./time-entry-modal";
import { BriefModal } from "./brief-modal";
import { LinksEditor, type LinksEditorHandle } from "./links-editor";
import { isSafeUrl, normalizeUrl } from "@/lib/links";
import type { Task, TimeEntry } from "@/lib/types";

/** Query param that deep-links straight to a task — what "Copy task link" writes. */
export const TASK_PARAM = "task";

/** Comments from the same person within this window share one avatar + byline. */
const COMMENT_GROUP_MS = 10 * 60_000;

/**
 * The pane's quiet-until-touched treatment.
 *
 * Every value here is editable, and saying so with a permanent box around each
 * one turned a task into a form of fourteen outlined controls — the reader's eye
 * has to discount all of them before it can find the assignee. Chrome appears on
 * hover and on keyboard focus; `focus-within` is what keeps it usable without a
 * mouse, since a control whose only affordance is hover is invisible to the
 * keyboard.
 */
const QUIET_FIELD =
  "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none transition-colors hover:border-border focus:border-brand";
/** …plus killing the native select arrow, which no amount of hover logic can hide. */
const QUIET_SELECT = `${QUIET_FIELD} appearance-none`;
/** The row wrapper that arms the hover group for the chevron and the icons. */
const META_ROW = "group/row flex items-center gap-3";

/**
 * Text hierarchy, following the Asana reference.
 *
 * The pane used to run every section label as `text-xs uppercase tracking-wide
 * text-faint` — 12px micro-caps at the LOWEST contrast on the page. That put
 * "Brief", "Attachments" and "Discussion" (the pane's structure) in the same
 * visual register as a file size, so nothing announced where one part of the
 * task ended and the next began. In the reference the section headings are the
 * second-loudest thing after the title: sentence case, semibold, full contrast.
 *
 * Three levels, and only three:
 *   · title            — 22px semibold, foreground
 *   · section heading  — 14px semibold, foreground
 *   · field label      — 13px regular, muted  (value beside it: 14px foreground)
 * Anything genuinely incidental (a file size, a timestamp) stays `text-faint`.
 */
const SECTION_HEADING = "text-sm font-semibold text-foreground";
/** w-20, not w-24: at half the pane's width every pixel of label is taken off the control. */
const FIELD_LABEL = "w-20 shrink-0 text-[13px] text-muted";

/**
 * A select with no permanent chrome. `appearance-none` removes the arrow the
 * browser paints whether you want it or not, and we draw our own only while the
 * row is hovered or holds focus — otherwise a keyboard user gets no affordance
 * at all.
 */
function QuietSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  // ⚠️ These three rows — Assignee, Type, Status — are NOT inside the pane's
  // `canEditFields` ternaries, because they are collaborative fields a member may
  // change (see migrations 0022/0024), so they had no read-only branch to reuse.
  // They are the only editors that survived the phone gate, and a native select
  // on touch opens a full-screen wheel — the easiest thing in the pane to change
  // by accident. Read-only here means rendering the CHOSEN LABEL as text.
  const isNarrow = useIsNarrow();
  if (isNarrow) {
    const chosen = Children.toArray(children).find(
      (c) => isValidElement<{ value?: string }>(c) && (c.props.value ?? "") === value,
    );
    const label =
      isValidElement<{ children?: React.ReactNode }>(chosen) ? chosen.props.children : null;
    return (
      <span className="min-w-0 flex-1 truncate px-1.5 text-sm">{label || <span className="text-faint">—</span>}</span>
    );
  }
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <select className={QUIET_SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown
        size={13}
        aria-hidden
        className="pointer-events-none absolute right-1.5 text-faint opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      />
    </span>
  );
}

/** "19/8 – 22/8", or one date, or an em dash. */
function dateRangeText(task: Task): string {
  const { startDate, dueDate } = task;
  if (startDate && dueDate) {
    return startDate === dueDate
      ? formatDayMonth(dueDate)
      : `${formatDayMonth(startDate)} – ${formatDayMonth(dueDate)}`;
  }
  if (dueDate) return formatDayMonth(dueDate);
  if (startDate) return `${formatDayMonth(startDate)} – ?`;
  return "—";
}

/**
 * The schedule as one control: the range in the row, both ends in a popover.
 *
 * Quiet like every other field here — it reads as text until hovered. The
 * popover is `absolute` (not `fixed`): the pane is its own scroll container, so
 * an anchored panel travels with the field instead of detaching from it.
 */
function DatesField({
  task,
  onChange,
}: {
  task: Task;
  onChange: (patch: { startDate?: string | null; dueDate?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const field =
    "rounded-md border border-border bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-brand";

  return (
    <span ref={wrap} className="relative flex min-w-0 flex-1 items-center">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Set the start and due dates"
        className={`${QUIET_FIELD} text-left tabular-nums ${task.dueDate || task.startDate ? "" : "text-faint"}`}
      >
        {dateRangeText(task)}
      </button>
      <CalendarDays
        size={13}
        aria-hidden
        className="pointer-events-none absolute right-1.5 text-faint opacity-0 transition-opacity group-hover/row:opacity-100"
      />
      {open && (
        // Anchored to the field's RIGHT edge: Dates sits in the right-hand
        // column of the two-column grid, a few pixels from the pane's edge, so
        // a left-anchored 224px panel hung off the side of the screen.
        <span className="absolute right-0 top-full z-40 mt-1 flex w-56 flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-xl pop-in">
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="w-9 shrink-0">Start</span>
            {/* An empty end opens on the OTHER end's month, not on today: a
                task due in October should not make you page back from August
                to give it a start date. Uncontrolled with a key so the default
                re-seeds when the sibling date changes; nothing is written
                until the value actually changes. */}
            <input
              key={`start-${task.startDate ?? task.dueDate ?? "none"}`}
              type="date"
              defaultValue={task.startDate ?? task.dueDate ?? ""}
              max={task.dueDate ?? undefined}
              onChange={(e) => onChange({ startDate: e.target.value || null })}
              className={`${field} min-w-0 flex-1`}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="w-9 shrink-0">Due</span>
            <input
              key={`due-${task.dueDate ?? task.startDate ?? "none"}`}
              type="date"
              defaultValue={task.dueDate ?? task.startDate ?? ""}
              min={task.startDate ?? undefined}
              onChange={(e) => onChange({ dueDate: e.target.value || null })}
              className={`${field} min-w-0 flex-1`}
            />
          </label>
          {task.startDate && (
            // Clearing the start turns a span back into a plain deadline, which
            // is what the Timeline draws as a diamond.
            <button
              onClick={() => onChange({ startDate: null })}
              className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-background hover:text-danger"
            >
              Clear start
            </button>
          )}
        </span>
      )}
    </span>
  );
}

function TaskAttachments({ taskId }: { taskId: string }) {
  const { attachments, addAttachment, removeAttachment } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = attachments.filter((a) => a.taskId === taskId);

  async function upload(fileList: FileList) {
    setError(null);
    setBusy(true);
    for (const file of Array.from(fileList)) {
      const body = new FormData();
      body.append("taskId", taskId);
      body.append("file", file);
      const res = await fetch("/api/task-attachments", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Upload failed");
        continue;
      }
      addAttachment(json);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    removeAttachment(id);
    await fetch("/api/task-attachments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="group/atts">
      <div className={`mb-1.5 ${SECTION_HEADING}`}>Attachments</div>
      {files.length > 0 && (
        <div className="mb-2 flex flex-col divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <div key={f.id} className="group/att flex items-center gap-2.5 px-3 py-2 text-sm">
              <span className="text-faint">📎</span>
              <a
                href={f.filePath}
                target="_blank"
                rel="noreferrer"
                className="bidi-auto min-w-0 flex-1 truncate font-medium text-brand hover:underline"
              >
                {f.fileName}
              </a>
              <span className="shrink-0 text-xs text-faint">{formatSize(f.sizeBytes)}</span>
              <button
                onClick={() => remove(f.id)}
                className="shrink-0 text-faint opacity-0 hover:text-danger group-hover/att:opacity-100"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {/* A permanent 46px dashed box for something used a few times a task is a
          lot of furniture. It stays reachable — it just stops shouting until you
          come near it, or tab to it. */}
      <label
        className={`flex w-full cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 py-2 text-xs transition-colors focus-within:border-brand focus-within:text-brand ${
          busy
            ? "border-brand text-brand"
            : "border-transparent text-faint group-hover/atts:border-border-strong group-hover/atts:text-muted hover:!border-brand hover:!text-brand"
        }`}
      >
        {busy ? "Uploading…" : "+ Add files (up to 25MB each)"}
        <input
          type="file"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function MoveEntriesModal({
  fromTask,
  entryIds,
  minutes,
  onDone,
}: {
  fromTask: Task;
  entryIds: string[];
  minutes: number;
  onDone: () => void;
}) {
  const { tasks, sections, clients, moveTimeEntries } = useData();
  const [search, setSearch] = useState("");

  const clientId = fromTask.clientId;

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = q
      ? tasks.filter((t) => t.title.toLowerCase().includes(q))
      : tasks.filter((t) => t.clientId === clientId && t.status !== "done");
    const isKeys = (t: Task) => /keys/i.test(t.title);
    return pool
      .filter((t) => t.id !== fromTask.id)
      .sort((a, b) => Number(isKeys(b)) - Number(isKeys(a)) || a.title.localeCompare(b.title))
      .slice(0, 30);
  }, [tasks, clientId, search, fromTask.id]);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onDone} />
      <div className="fixed left-1/2 top-1/3 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <h3 className="mb-1 font-heading text-sm">
          Move {formatHours(minutes)} ({entryIds.length} entr{entryIds.length === 1 ? "y" : "ies"})
        </h3>
        <p className="mb-3 text-xs text-muted">
          From <span className="bidi-auto font-medium text-foreground">{fromTask.title}</span> — the
          entries keep their dates and descriptions, with a &quot;moved&quot; audit trail.
        </p>
        <input
          autoFocus
          placeholder={`Search all tasks… (empty = ${clients.find((c) => c.id === clientId)?.name ?? "client"} open tasks)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bidi-auto mb-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
        <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {candidates.map((t) => {
            const c = clients.find((cc) => cc.id === t.clientId);
            const s = sections.find((ss) => ss.id === t.sectionId);
            const keys = /keys/i.test(t.title);
            return (
              <button
                key={t.id}
                onClick={() => {
                  moveTimeEntries(entryIds, fromTask.id, t.id);
                  onDone();
                }}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background ${keys ? "bg-amber-50" : ""}`}
              >
                <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{t.title}</span>
                {keys && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">KEYS</span>}
                <span className="shrink-0 text-xs text-faint">
                  {c?.name}
                  {s && <> › {s.name}</>}
                </span>
              </button>
            );
          })}
          {candidates.length === 0 && (
            <div className="px-2 py-3 text-center text-sm text-faint">No matching tasks.</div>
          )}
        </div>
      </div>
    </>
  );
}

/** ⚠️ The pane's slide, in ms. The CSS transitions below and the close timer must
 *  both read this — a JS timer shorter than the CSS yanks the pane mid-slide, and
 *  longer leaves it mounted and invisible, swallowing clicks. */
const PANE_MS = 260;

export function TaskPanel() {
  const {
    openTaskId,
    openTask,
    tasks,
    sections,
    taskGroups,
    clients,
    profiles,
    comments,
    timeEntries,
    tags,
    taskTypes,
    freshEntryId,
    updateTask,
    addComment,
    deleteComment,
    taskMinutes,
    currentUserId,
  } = useData();

  const [commentDraft, setCommentDraft] = useState("");
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  /** Add ({entry:null}) or edit one time entry. */
  const [entryModal, setEntryModal] = useState<{ entry: TimeEntry | null } | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [editingFigma, setEditingFigma] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const linksRef = useRef<LinksEditorHandle>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /**
   * ⚠️ 1C (Nitsan's pick): the pane slides 260ms, and `PANE_MS` must equal the CSS
   * duration below.
   *
   * ⚠️ THE EXIT IS OWNED BY `closing`, NOT BY THE HOOK, and that is the whole
   * design. On close the pane has to keep drawing the task it was showing — but
   * `openTaskId` is what it derives that task from, so instead of remembering the
   * task, `closePane` DELAYS CLEARING THE STORE until the slide is done. Nothing
   * is duplicated and nothing is read during render. (The first attempt held the
   * task in a ref and read it while rendering, which the React Compiler correctly
   * refuses — it took eslint from 38 warnings to 111.)
   */
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paneEntered = useEnterTransition(!!openTaskId && !closing);
  const [copied, setCopied] = useState(false);
  const isAdmin = useIsAdmin();
  const isNarrow = useIsNarrow();
  /** Which of the three mobile tabs is showing. Ignored at ≥768px. */
  const [tab, setTab] = useState<"details" | "time" | "talk">("details");

  /**
   * ⚠️ A PHONE READS; IT DOES NOT EDIT FIELDS. Every value here is editable and
   * most of the editors are hover-revealed, inline, and anchored — a date popout
   * that measures its cell, a select styled to look like text, a title that turns
   * into an input. None of that survives a thumb, and re-doing eight editors for
   * touch is a bigger job than the whole rest of the mobile work.
   *
   * So the phone gets the read-only rendering that ALREADY EXISTS for members —
   * every one of these six had a non-admin branch, so this is a gate, not a new
   * layout. Logging time and commenting stay live, because those are the two
   * things people actually want to do away from a desk.
   */
  const canEditFields = isAdmin && !isNarrow;

  /** Active tab shows; the others collapse. `contents` keeps the parent's flex
   *  `gap-5` between siblings, so wrapping changes no desktop spacing at all. */
  const paneOf = (id: "details" | "time" | "talk") =>
    tab === id ? "contents" : "hidden md:contents";

  /**
   * Open whatever `?task=<id>` points at, once, on mount. Deliberately reads
   * `window.location` instead of `useSearchParams`, which would drag a Suspense
   * boundary into the shell for a one-shot read. The task need not be loaded
   * yet — the pane renders nothing until it is, then appears.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(TASK_PARAM);
    if (id) openTask(id);
    // openTask is stable (useCallback over a stable dep); running this once is the point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A task ALWAYS opens in the side pane; maximising is something you then do to
   * it, not a mode the app remembers. This used to persist to localStorage, so
   * one click of maximise meant every task afterwards took over the whole screen
   * — including tasks opened from the plan or the feed, where the point is to
   * keep the thing behind it in view. Reset on each open.
   */
  useEffect(() => {
    if (openTaskId) setFullscreen(false);
  }, [openTaskId]);

  async function copyLink(taskId: string) {
    const url = `${window.location.origin}/?${TASK_PARAM}=${taskId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be refused (Safari, an insecure origin). Say so
      // rather than flashing "Copied!" over a clipboard that still holds
      // whatever was there before.
      window.prompt("Copy this task link:", url);
    }
  }

  const task = tasks.find((t) => t.id === openTaskId);
  if (!task) return null;

  const client = clients.find((c) => c.id === task.clientId);
  const taskType = taskTypes.find((t) => t.id === task.typeId) ?? null;
  const section = sections.find((s) => s.id === task.sectionId);
  const clientSections = sections
    .filter((s) => s.clientId === task.clientId)
    .sort((a, b) => a.position - b.position);
  const taskGroup = taskGroups.find((g) => g.id === task.groupId) ?? null;
  /** Groups of this task's OWN section — see the Group row for why. */
  const clientGroups = taskGroups
    .filter((g) => g.clientId === task.clientId && g.sectionId === (task.sectionId ?? null))
    .sort((a, b) => a.position - b.position);
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  const taskComments = comments.filter((c) => c.taskId === task.id);
  const entries = timeEntries
    .filter((e) => e.taskId === task.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  /**
   * The SAME total the client table shows — it includes the pre-Everhour remainder
   * that never became individual entries. The pane used to count only itemised
   * entries, so a recovered task read 12h here and 165h in the table. The list
   * below carries an explicit line for the remainder, so the rows still add up to
   * this headline.
   */
  const doneMinutes = taskMinutesDone(task, taskMinutes);
  const legacyMinutes = taskLegacyMinutes(task);
  const overBudget = task.estimateHours != null && doneMinutes / 60 > task.estimateHours;
  const activeProfiles = profiles.filter((p) => p.active);

  /**
   * ⚠️ Closing the pane commits a link left typed into the inline form below —
   * "+ Add link" opens it, and until v1.21.1 clicking the backdrop or the ✕ just
   * unmounted it and threw the contents away. Same rule, and same reason, as
   * `BriefModal.close`.
   */
  function closePane() {
    linksRef.current?.commitPending();
    // ⚠️ The link form is committed FIRST, before the delay — a save must not wait
    // on an animation, and the pane may be unmounted by another path mid-slide.
    if (closeTimer.current) return; // already closing; a second click is a no-op
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      openTask(null);
    }, PANE_MS);
  }

  return (
    <>
      {/* ⚠️ The backdrop fades WITH the panel on the same curve — a backdrop that
          snaps while the panel slides is the thing that reads as a glitch.
          `pointer-events` drop as soon as it starts leaving, or the closing pane
          swallows the next click for 260ms. */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        style={{
          opacity: paneEntered ? 1 : 0,
          transition: `opacity ${PANE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          pointerEvents: paneEntered ? "auto" : "none",
        }}
        onClick={closePane}
      />
      {/* Full screen is the same panel widened to the viewport — not a second
          layout — so every control below behaves identically in both modes. */}
      <div
        // `h-dvh` alongside `inset-y-0`: on a phone `100vh` is the tall viewport
        // the URL bar is hiding, so the last comment sat under the browser chrome
        // and the composer was unreachable. Same fix as the public Gantt (v1.9.2).
        className={`fixed z-50 flex h-dvh flex-col overflow-y-auto bg-surface shadow-2xl ${
          fullscreen
            ? "inset-0 w-full"
            : "inset-y-0 right-0 w-full max-w-xl border-l border-border"
        }`}
        // ⚠️ `transform`, never `right`/`width`: the pane holds the comment thread
        // and the time list, so a layout-property slide would re-flow all of it on
        // every frame. Full screen is deliberately NOT slid from the side — it is
        // the same panel widened, so once open it must not re-animate.
        style={{
          transform: paneEntered || fullscreen ? "none" : "translateX(100%)",
          transition: `transform ${PANE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          pointerEvents: paneEntered ? "auto" : "none",
        }}
      >
        {/* Toolbar */}
        <div className="sticky top-0 z-10 border-b border-border bg-surface px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            {canEditFields ? (
              <button
                onClick={() =>
                  updateTask(task.id, {
                    status: task.status === "done" ? "todo" : "done",
                  })
                }
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  task.status === "done"
                    ? "border-success bg-emerald-50 text-success"
                    : "border-border-strong text-muted hover:border-success hover:text-success"
                }`}
              >
                ✓ {task.status === "done" ? "Completed" : "Mark complete"}
              </button>
            ) : (
              <span
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  task.status === "done"
                    ? "border-success bg-emerald-50 text-success"
                    : "border-border text-muted"
                }`}
                title="Only admins can complete tasks"
              >
                {task.status === "done" ? "✓ Completed" : "In progress"}
              </span>
            )}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => copyLink(task.id)}
                title="Copy task link"
                aria-label="Copy task link"
                className={`rounded-md p-1.5 hover:bg-background ${
                  copied ? "text-success" : "text-muted hover:text-brand"
                }`}
              >
                <Link2 size={16} />
              </button>
              {copied && <span className="text-xs text-success">Copied</span>}
              {/* Full screen is meaningless on a phone — the pane already fills
                  the screen, so the control would toggle nothing. */}
              <button
                onClick={() => setFullscreen((f) => !f)}
                title={fullscreen ? "Exit full screen" : "Full screen"}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                className="hidden rounded-md p-1.5 text-muted hover:bg-background hover:text-brand md:block"
              >
                {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                onClick={closePane}
                title="Close"
                className="rounded-md px-2 py-1 text-muted hover:bg-background"
              >
                ✕
              </button>
            </div>
          </div>
          {task.pending && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Pending approval — from client intake, not yet confirmed by an admin.
            </div>
          )}
        </div>

        {/* Full screen caps the reading column: a brief and a comment thread set
            across 1900px is unreadable, and every row here is label + value. */}
        <div
          className={`flex flex-col gap-5 px-6 py-5 ${fullscreen ? "mx-auto w-full max-w-3xl" : ""}`}
        >
          {/* The pane is now the ONLY place a task can be renamed — the client
              table's inline editor was removed in favour of click-to-open. */}
          {canEditFields ? (
            <h2 className="text-[22px] font-semibold leading-tight">
              <EditableTextCell
                value={task.title}
                onCommit={(v) => v && v !== task.title && updateTask(task.id, { title: v })}
              />
            </h2>
          ) : (
            <h2 className="bidi-auto text-[22px] font-semibold leading-tight">{task.title}</h2>
          )}

          {/* Phone-only tab strip. The pane is one long column on a laptop and
              that is right there — you can see the brief and the discussion at
              once. On a 375px screen the same column puts the thread four or
              five screens down, and the thread is the half of a task people
              actually come back to.
              ⚠️ The three panes are wrapped in `contents`/`hidden md:contents`,
              NOT rendered conditionally: `display: contents` makes the wrapper
              vanish from layout, so at ≥768px the children remain direct flex
              items of this column and the existing `gap-5` between sections is
              untouched. Conditional rendering would also throw away the comment
              draft and the scroll position on every tab switch. */}
          <div
            role="tablist"
            aria-label="Task sections"
            className="-mx-6 flex gap-5 border-b border-border px-6 md:hidden"
          >
            {(
              [
                ["details", "Details"],
                ["time", `Time${entries.length ? ` · ${entries.length}` : ""}`],
                ["talk", `Talk${comments.length ? ` · ${comments.length}` : ""}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px min-h-11 border-b-2 text-sm ${
                  tab === id
                    ? "border-brand font-medium text-foreground"
                    : "border-transparent text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={paneOf("details")}>
          {/*
            Meta rows, Asana-style label:value — in TWO columns above the Hours
            figure. Seven single-file rows pushed the brief and the discussion
            below the fold on a laptop; paired up they cost half the height. The
            grid collapses to one column under `sm`, where two 130px controls
            would be unusable.
          */}
          <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 text-sm text-foreground sm:grid-cols-2">
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Assignee</span>
              <Avatar profile={assignee} size={24} />
              <QuietSelect
                value={task.assigneeId ?? ""}
                onChange={(v) => updateTask(task.id, { assigneeId: v || null })}
              >
                <option value="">No assignee</option>
                {activeProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </QuietSelect>
            </div>
            {/* ONE Dates row, not a Start row and a Due row. A task's schedule
                is a span — "19/8 – 22/8" is the sentence people say — and two
                separate fields made you read both to learn one fact. */}
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Dates</span>
              {canEditFields ? (
                <DatesField task={task} onChange={(patch) => updateTask(task.id, patch)} />
              ) : (
                <span className="px-1.5 py-1 tabular-nums">{dateRangeText(task)}</span>
              )}
            </div>
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Client</span>
              <span className="flex min-w-0 flex-1 items-center gap-2 px-1.5">
                {client && <ClientChip client={client} size="sm" />}
              </span>
            </div>
            {/* Section is its own row so admins can move the task between the
                client's sections without dragging. Members see it read-only —
                migration 0011's trigger makes section_id admin-only in the DB too. */}
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Section</span>
              {canEditFields ? (
                <QuietSelect
                  value={task.sectionId ?? ""}
                  onChange={(v) => updateTask(task.id, { sectionId: v || null })}
                >
                  <option value="">No section</option>
                  {clientSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </QuietSelect>
              ) : (
                <span className="bidi-auto min-w-0 flex-1 truncate px-1.5 py-1">
                  {section?.name ?? "—"}
                </span>
              )}
            </div>
            {/* Group (0027), the same reasoning one level down: dragging is fine
                on the client table and hopeless from here, and a task opened from
                the plan or the feed has no table to drag on at all.
                ⚠️ The list is the groups of THIS TASK'S SECTION only. A group
                belongs to one section, so offering another section's groups would
                offer to move the task twice in one control — the store would
                follow the group and silently re-section the task. Change the
                section first; the row above is right there.
                The row is hidden entirely when the section has no groups, rather
                than showing an empty picker: most sections won't have any, and a
                dead control on every task is worse than a row that appears when
                there is something to choose. */}
            {(clientGroups.length > 0 || task.groupId) && (
              <div className={META_ROW}>
                <span className={FIELD_LABEL}>Group</span>
                {canEditFields ? (
                  <QuietSelect
                    value={task.groupId ?? ""}
                    onChange={(v) => updateTask(task.id, { groupId: v || null })}
                  >
                    <option value="">No group</option>
                    {clientGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </QuietSelect>
                ) : (
                  <span className="bidi-auto min-w-0 flex-1 truncate px-1.5 py-1">
                    {taskGroup?.name ?? "—"}
                  </span>
                )}
              </div>
            )}
            {/* Type = the kind of work; Tag = where it is in the process. Two
                axes on purpose (0024) — a task is a QA job AND awaiting approval.
                The Timeline paints its bars with the type's colour. */}
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Type</span>
              {taskType && (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: taskType.color }}
                  aria-hidden
                />
              )}
              <QuietSelect
                value={task.typeId ?? ""}
                onChange={(v) => updateTask(task.id, { typeId: v || null })}
              >
                <option value="">—</option>
                {taskTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </QuietSelect>
            </div>
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Status</span>
              <QuietSelect
                value={task.tag ?? ""}
                onChange={(v) => updateTask(task.id, { tag: v || null })}
              >
                <option value="">—</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </QuietSelect>
            </div>
            <div className={META_ROW}>
              <span className={FIELD_LABEL}>Billable</span>
              {canEditFields ? (
                <button
                  onClick={() => updateTask(task.id, { billable: !task.billable })}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    task.billable
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {task.billable ? "Billable" : "Non-billable"}
                </button>
              ) : (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    task.billable
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {task.billable ? "Billable" : "Non-billable"}
                </span>
              )}
            </div>
            {/* Hours spans both columns: the 24px figure and its bar are the
                one thing here that isn't a label:value pair. */}
            <div className={`${META_ROW} sm:col-span-2`}>
              <span className={FIELD_LABEL}>Hours</span>
              <span className="flex items-baseline gap-1">
                <span
                  className={`text-2xl font-semibold tabular-nums ${overBudget ? "text-danger" : ""}`}
                  title={`${formatHours(doneMinutes)} logged`}
                >
                  {formatHoursDecimal(doneMinutes)}
                </span>
                <span className="text-2xl text-faint">/</span>
                {canEditFields ? (
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="w-16 rounded-md border border-transparent bg-transparent text-2xl font-semibold tabular-nums hover:border-border focus:border-brand focus:outline-none"
                    value={task.estimateHours ?? ""}
                    placeholder="–"
                    title="Budget in hours"
                    onChange={(e) =>
                      updateTask(task.id, {
                        estimateHours: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                ) : (
                  <span className="w-16 text-2xl font-semibold tabular-nums">
                    {task.estimateHours ?? "–"}
                  </span>
                )}
                <span className="self-end pb-1 text-xs text-muted">h</span>
              </span>
              {task.estimateHours != null && (
                <span className="min-w-0 flex-1">
                  {/* label="none": the numbers are already spelled out above it */}
                  <BudgetBar
                    doneMinutes={doneMinutes}
                    estimateHours={task.estimateHours}
                    label="none"
                  />
                </span>
              )}
            </div>
          </div>

          {/* Figma link.
              ⚠️ On a phone the whole section is dropped when there is no link:
              its "empty" state is a full-width text input, and this pane is
              read-only there — an editor you can focus but whose value you were
              never meant to change is worse than an absent row. With a link it
              still renders, because opening the file is reading, not editing. */}
          <div className={!task.figmaUrl && isNarrow ? "hidden" : undefined}>
            <div className={`mb-1.5 ${SECTION_HEADING}`}>Figma</div>
            {task.figmaUrl && (!editingFigma || isNarrow) ? (
              <span className="group/figma flex items-center gap-2">
                {isSafeUrl(task.figmaUrl) ? (
                  <a
                    href={task.figmaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                  >
                    ◇ Open in Figma
                  </a>
                ) : (
                  // ⚠️ Checked at RENDER as well as on write, because rows predate
                  // this guard and can be edited straight in SQL. React 19 THROWS
                  // on a `javascript:` href and the app has no error boundary, so
                  // an unchecked one here blanked the whole pane for everybody.
                  <span
                    className="bidi-auto min-w-0 flex-1 truncate text-sm text-muted line-through"
                    title="This link isn't a normal web address, so it isn't clickable"
                  >
                    {task.figmaUrl}
                  </span>
                )}
                <button
                  onClick={() => setEditingFigma(true)}
                  title="Edit link"
                  className="invisible rounded p-0.5 text-faint hover:text-brand group-hover/figma:visible"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => updateTask(task.id, { figmaUrl: null })}
                  title="Remove link"
                  className="invisible rounded p-0.5 text-faint hover:text-danger group-hover/figma:visible"
                >
                  <X size={14} />
                </button>
              </span>
            ) : (
              <input
                autoFocus={editingFigma}
                defaultValue={task.figmaUrl ?? ""}
                placeholder="Paste Figma link…"
                // Empty and untouched, this was a full-width outlined box on every
                // task that has no Figma file — which is most of them. Once you're
                // actually editing (`editingFigma`) it keeps its border.
                className={`w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand focus:bg-surface ${
                  editingFigma ? "border-border bg-surface" : "border-transparent hover:border-border"
                }`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    (e.target as HTMLInputElement).value = task.figmaUrl ?? "";
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  // Normalised before it is stored — same helper, same allowlist
                  // (http/https/mailto) the studio's own link editor uses. A
                  // paste that can't be made into a URL clears the field rather
                  // than storing something no one can click.
                  const next = v ? normalizeUrl(v) : null;
                  if ((next ?? "") !== (task.figmaUrl ?? "")) {
                    updateTask(task.id, { figmaUrl: next });
                  }
                  setEditingFigma(false);
                }}
              />
            )}
          </div>

          {/* Brief — read-only here, click to edit in a room big enough for it.
              The brief was previously the one field with no editor anywhere in
              the app: only the public intake form ever wrote it. */}
          <div className="group/brief">
            <div className="mb-1 flex items-center gap-2">
              <span className={SECTION_HEADING}>Brief</span>
              {/* Both edit affordances are `md:` only. A hover-revealed control
                  has no resting state a thumb can find anyway, so on a phone
                  these were invisible buttons that opened an editor by accident. */}
              <button
                onClick={() => setEditingBrief(true)}
                className="hidden items-center gap-1 rounded px-1 py-0.5 text-xs text-faint opacity-0 transition-opacity hover:bg-background hover:text-brand focus-visible:opacity-100 group-hover/brief:opacity-100 md:flex"
                title="Edit brief and links"
              >
                <Pencil size={12} /> Edit
              </button>
              {/* Adding a link is a heading-level action, so it sits on the
                  heading's line — not below the list, where it was one more
                  left-aligned control in a stack of them. */}
              <button
                onClick={() => linksRef.current?.startAdding()}
                className="ml-auto hidden items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-background hover:text-brand md:flex"
                title="Add a titled link"
              >
                + Add link
              </button>
            </div>
            {/* ⚠️ A DIV on a phone, not a disabled button. `BriefModal` is a
                full-height textarea that saves on close — backdrop tap included —
                so it must not be reachable from a read-only pane. Keeping the
                `<button>` and dropping its handler would leave a focusable
                control that does nothing, which is worse for a keyboard or
                screen-reader user than plain text. */}
            {isNarrow ? (
              <div className="bidi-auto w-full whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed">
                {task.brief || <span className="text-faint">No brief yet.</span>}
              </div>
            ) : (
              <button
                onClick={() => setEditingBrief(true)}
                title="Edit brief and links"
                className="bidi-auto w-full whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm leading-relaxed hover:border-brand"
              >
                {task.brief || (
                  <span className="text-faint">No brief yet — click to write one.</span>
                )}
              </button>
            )}
            {/* Links live with the brief because that's where they were being
                pasted: a Google Doc URL in the middle of a paragraph. */}
            <div className="mt-2">
              <LinksEditor
                ref={linksRef}
                owner={{ taskId: task.id }}
                canEdit
                emptyHint=""
                showAddButton={false}
              />
            </div>
          </div>

          {/* Attachments */}
          <TaskAttachments taskId={task.id} />
          </div>

          <div className={paneOf("time")}>
          {/* Time */}
          <div>
            {/* The heading is "Time"; the total is a fact about it, so it rides
                alongside at the incidental weight rather than shouting equally. */}
            <div className="mb-1.5 flex items-baseline gap-2">
              <h3 className={SECTION_HEADING}>Time</h3>
              <span className="text-xs tabular-nums text-faint">
                {formatHours(doneMinutes)} total
              </span>
            </div>
            {isAdmin && selectedEntries.size > 0 && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-brand-soft px-3 py-2 text-sm">
                <span className="font-medium text-brand-dark">
                  {selectedEntries.size} selected —{" "}
                  {formatHours(
                    entries
                      .filter((e) => selectedEntries.has(e.id))
                      .reduce((s, e) => s + e.minutes, 0),
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedEntries(new Set())}
                    className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowMove(true)}
                    className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
                  >
                    Move to…
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {/* 37px = the rendered height of a px-3 py-2 text-sm row, so the tile
                  is square and flush with the lines below it */}
              <div className="flex">
                <button
                  onClick={() => setEntryModal({ entry: null })}
                  title="Log time on this task"
                  className="flex size-[37px] items-center justify-center text-faint hover:bg-brand-soft hover:text-brand"
                >
                  <Plus size={16} />
                </button>
              </div>
              {entries.length === 0 && (
                <div className="px-3 py-2.5 text-sm text-faint">No time logged yet.</div>
              )}
              {entries.map((e) => {
                const user = profiles.find((p) => p.id === e.userId) ?? null;
                // Same as the comments below: a recovered entry names its author in
                // legacy_author_name because that person has no account here.
                const author = user?.name ?? e.legacyAuthorName ?? "";
                // Rows you may not change are NOT interactive at all — no pointer,
                // no hover, no handler. An editor you can open but not use is worse
                // than none.
                const clickable = canEditEntry(e, isAdmin, currentUserId);
                return (
                  <div
                    key={e.id}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => setEntryModal({ entry: e }) : undefined}
                    onKeyDown={
                      clickable
                        ? (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              setEntryModal({ entry: e });
                            }
                          }
                        : undefined
                    }
                    // ⚠️ 3A: the row you just logged flashes once. It lands in a
                    // DATE-SORTED list, so without this an hour logged on an old
                    // date appears somewhere off-screen with nothing to say so.
                    className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                      clickable ? "cursor-pointer hover:bg-background" : ""
                    } ${e.id === freshEntryId ? "row-flash" : ""}`}
                  >
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) =>
                          setSelectedEntries((prev) => {
                            const next = new Set(prev);
                            if (ev.target.checked) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          })
                        }
                        className="shrink-0"
                        title="Select for moving"
                      />
                    )}
                    {/* A recovered entry has no profile to draw, so the avatar
                        falls back to a dashed "?" — and its own tooltip has to
                        carry the author, since an inner title wins over a
                        wrapper's. `author` is the stored provenance string for
                        rows that name nobody ("(from finance plan)"), which is
                        still more use than the word "Unassigned". */}
                    <Avatar
                      profile={user}
                      size={22}
                      emptyTitle={author || "Author not recorded — recovered history"}
                    />
                    <span
                      className={`w-14 shrink-0 text-xs ${e.dateEstimated ? "text-faint italic" : "text-muted"}`}
                      // The hours are the studio's own recorded figure; only the day
                      // is inferred. Showing it plainly would present a guess as a fact.
                      title={
                        e.dateEstimated
                          ? "Date estimated from this task's activity window — the hours are from the task's own recorded total"
                          : undefined
                      }
                    >
                      {formatDate(e.date)}
                      {e.dateEstimated ? "*" : ""}
                    </span>
                    <span className="w-14 shrink-0 font-medium tabular-nums">{formatHours(e.minutes)}</span>
                    <span className="bidi-auto min-w-0 flex-1 truncate text-muted">
                      {e.description || <span className="text-faint italic">no description</span>}
                    </span>
                    {e.movedFromTaskId && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700" title="Moved from another task">
                        moved
                      </span>
                    )}
                  </div>
                );
              })}
              {/* The remainder that never became entries. Without this line the rows
                  would sum to less than the headline with no explanation, which is
                  exactly how a figure loses people's trust. */}
              {legacyMinutes > 0 && (
                <div
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-faint"
                  title="Recorded on the task itself in the pre-Everhour Asana history, with no person or day to pin it to. Counted in the total above."
                >
                  <span className="w-[22px] shrink-0 text-center">–</span>
                  <span className="w-14 shrink-0 text-xs">—</span>
                  <span className="w-14 shrink-0 font-medium tabular-nums">
                    {formatHours(legacyMinutes)}
                  </span>
                  <span className="min-w-0 flex-1 truncate italic">
                    pre-Everhour history (not itemised)
                  </span>
                </div>
              )}
            </div>
          </div>

          </div>

          <div className={paneOf("talk")}>
          {/* Discussion — its own surface.
              Everything above is a form: label on the left, value on the right,
              all of it on the pane's own background. The thread is the one part
              that is a conversation, so it sits in a recessed panel with its own
              heading weight and its composer pinned to the bottom of it. That
              separation is the whole point of the Asana reference: you should be
              able to tell at a glance where the record stops and the talking
              starts, without reading a word. */}
          <div className="-mx-1 rounded-2xl bg-background p-3 ring-1 ring-border/60">
            <div className="mb-2.5 flex items-baseline gap-2">
              <h3 className={SECTION_HEADING}>Discussion</h3>
              {taskComments.length > 0 && (
                <span className="text-xs tabular-nums text-faint">{taskComments.length}</span>
              )}
            </div>
            {/* A conversation, not another log: bubbles, own messages on the
                right, and one avatar + byline per run of messages from the same
                person. It used to be avatar-plus-two-lines, which is exactly the
                shape of the time rows above and read as more of the same. */}
            <div className="mb-2 flex flex-col gap-2">
              {taskComments.map((c, i) => {
                const user = profiles.find((p) => p.id === c.userId) ?? null;
                // An imported pre-Everhour comment usually has no profile — its author
                // left long before the current roster. Without this fallback the name
                // rendered EMPTY on 2,175 of the 2,397 imported comments.
                const author = user?.name ?? c.authorName ?? "";
                // imported comments have no userId, so they correctly sit on the left
                const mine = !!c.userId && c.userId === currentUserId;
                const prev = taskComments[i - 1];
                const sameRun =
                  !!prev &&
                  prev.userId === c.userId &&
                  (prev.authorName ?? null) === (c.authorName ?? null) &&
                  new Date(c.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                    COMMENT_GROUP_MS;
                const stamp = new Date(c.createdAt);
                const today = new Date().toDateString() === stamp.toDateString();
                return (
                  <div
                    key={c.id}
                    className={`group/msg flex gap-2.5 ${mine ? "flex-row-reverse" : ""} ${
                      sameRun ? "" : "mt-1"
                    }`}
                  >
                    {sameRun ? (
                      <span className="size-[26px] shrink-0" aria-hidden />
                    ) : (
                      <Avatar profile={user} size={26} emptyTitle={author || "Unknown author"} />
                    )}
                    <div className={`flex min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
                      {!sameRun && (
                        <span className="mb-0.5 flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold">{author}</span>
                        </span>
                      )}
                      {/* The bubble sits on `bg-surface` now, because the panel
                          around it is `bg-background` — the old pairing put a
                          background-coloured bubble on a background-coloured
                          pane and only the border said anything was there. */}
                      <span
                        className={`bidi-auto max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          mine
                            ? "rounded-tr-sm bg-brand-soft text-brand-dark"
                            : "rounded-tl-sm border border-border bg-surface"
                        }`}
                      >
                        {c.body}
                      </span>
                      {/* Timestamp and the delete control share one line and the
                          same faint weight, so the row costs nothing until you
                          reach for it. */}
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-faint" title={stamp.toLocaleString("en-GB")}>
                          {today
                            ? stamp.toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : stamp.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            title="Delete this message (⌘Z undoes it)"
                            aria-label="Delete message"
                            className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/msg:opacity-100"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <form
              className="flex gap-2 border-t border-border/70 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!commentDraft.trim()) return;
                addComment(task.id, commentDraft.trim());
                setCommentDraft("");
              }}
            >
              <input
                placeholder="Write a comment…"
                className="bidi-auto flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <button className="min-h-11 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark md:min-h-0">
                Send
              </button>
            </form>
          </div>
          </div>

          {task.tag && (
            <div className="flex items-center gap-2 text-xs text-muted">
              Current tag: <TagBadge tag={task.tag} />
            </div>
          )}
        </div>
      </div>

      {showMove && (
        <MoveEntriesModal
          fromTask={task}
          entryIds={[...selectedEntries]}
          minutes={entries
            .filter((e) => selectedEntries.has(e.id))
            .reduce((s, e) => s + e.minutes, 0)}
          onDone={() => {
            setShowMove(false);
            setSelectedEntries(new Set());
          }}
        />
      )}

      {entryModal && (
        // "raised": this opens from inside the drawer, which is itself z-40/z-50
        <TimeEntryModal
          taskId={task.id}
          entry={entryModal.entry}
          layer="raised"
          onClose={() => setEntryModal(null)}
        />
      )}

      {editingBrief && <BriefModal task={task} onClose={() => setEditingBrief(false)} />}
    </>
  );
}
