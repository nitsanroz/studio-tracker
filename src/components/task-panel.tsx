"use client";

import { useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate, formatHours, toISODate } from "@/lib/format";
import { loggableMembers } from "@/lib/members";
import { Avatar, BudgetBar, ClientChip, TagBadge } from "./ui";
import type { Task } from "@/lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Attachments</div>
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
      <label className="flex w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-strong px-3 py-3 text-sm text-muted hover:border-brand hover:text-brand">
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

export function TaskPanel() {
  const {
    openTaskId,
    openTask,
    tasks,
    sections,
    clients,
    profiles,
    comments,
    timeEntries,
    tags,
    updateTask,
    addComment,
    addTimeEntry,
    taskMinutes,
    currentUserId,
  } = useData();

  const [commentDraft, setCommentDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState({ hours: "", description: "" });
  /**
   * Who the new time entry is for. Admins log hours on behalf of designers who
   * forgot, so the form needs a person; members never see the control and
   * always attribute to themselves. `null` means "me" so it can't go stale if
   * the session changes under us.
   */
  const [timeForUserId, setTimeForUserId] = useState<string | null>(null);
  /**
   * The day the new entry is for. Admins backfill hours a designer forgot, so
   * "today" is often wrong; it stays put after an add rather than snapping back,
   * because backfilling is usually several entries on the same past day.
   */
  const [timeDate, setTimeDate] = useState(() => toISODate(new Date()));
  const timeMembers = useMemo(() => loggableMembers(profiles, currentUserId), [profiles, currentUserId]);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [showMove, setShowMove] = useState(false);
  const [editingFigma, setEditingFigma] = useState(false);

  const task = tasks.find((t) => t.id === openTaskId);
  if (!task) return null;

  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const client = clients.find((c) => c.id === task.clientId);
  const section = sections.find((s) => s.id === task.sectionId);
  const clientSections = sections
    .filter((s) => s.clientId === task.clientId)
    .sort((a, b) => a.position - b.position);
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  const taskComments = comments.filter((c) => c.taskId === task.id);
  const entries = timeEntries
    .filter((e) => e.taskId === task.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const doneMinutes = taskMinutes(task.id);
  const activeProfiles = profiles.filter((p) => p.active);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => openTask(null)}
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 border-b border-border bg-surface px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            {isAdmin ? (
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
            <button
              onClick={() => openTask(null)}
              className="rounded-md px-2 py-1 text-muted hover:bg-background"
            >
              ✕
            </button>
          </div>
          {task.pending && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Pending approval — from client intake, not yet confirmed by an admin.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <h2 className="bidi-auto text-2xl">{task.title}</h2>

          {/* Meta rows, Asana-style label:value */}
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Assignee</span>
              <Avatar profile={assignee} size={24} />
              <select
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border"
                value={task.assigneeId ?? ""}
                onChange={(e) => updateTask(task.id, { assigneeId: e.target.value || null })}
              >
                <option value="">No assignee</option>
                {activeProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Due date</span>
              {isAdmin ? (
                <input
                  type="date"
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border"
                  value={task.dueDate ?? ""}
                  onChange={(e) => updateTask(task.id, { dueDate: e.target.value || null })}
                />
              ) : (
                <span className="px-1.5 py-1 tabular-nums">
                  {task.dueDate ? formatDate(task.dueDate) : "—"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Client</span>
              <span className="flex min-w-0 flex-1 items-center gap-2 px-1.5">
                {client && <ClientChip client={client} size="sm" />}
              </span>
            </div>
            {/* Section is its own row so admins can move the task between the
                client's sections without dragging. Members see it read-only —
                migration 0011's trigger makes section_id admin-only in the DB too. */}
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Section</span>
              {isAdmin ? (
                <select
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border"
                  value={task.sectionId ?? ""}
                  onChange={(e) => updateTask(task.id, { sectionId: e.target.value || null })}
                >
                  <option value="">No section</option>
                  {clientSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="bidi-auto min-w-0 flex-1 truncate px-1.5 py-1">
                  {section?.name ?? "—"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Tag</span>
              <select
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border"
                value={task.tag ?? ""}
                onChange={(e) => updateTask(task.id, { tag: e.target.value || null })}
              >
                <option value="">—</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Billable</span>
              {isAdmin ? (
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
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-muted">Budget</span>
              {isAdmin ? (
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border"
                  value={task.estimateHours ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    updateTask(task.id, {
                      estimateHours: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              ) : (
                <span className="w-20 px-1.5 py-1 tabular-nums">{task.estimateHours ?? "—"}</span>
              )}
              <span className="text-xs text-muted">hours</span>
              <span className="min-w-0 flex-1">
                {task.estimateHours != null ? (
                  <BudgetBar doneMinutes={doneMinutes} estimateHours={task.estimateHours} />
                ) : (
                  <span className="text-xs text-muted">{formatHours(doneMinutes)} logged</span>
                )}
              </span>
            </div>
          </div>

          {/* Figma link */}
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Figma</div>
            {task.figmaUrl && !editingFigma ? (
              <span className="group/figma flex items-center gap-2">
                <a
                  href={task.figmaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                >
                  ◇ Open in Figma
                </a>
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
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    (e.target as HTMLInputElement).value = task.figmaUrl ?? "";
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (task.figmaUrl ?? "")) updateTask(task.id, { figmaUrl: v || null });
                  setEditingFigma(false);
                }}
              />
            )}
          </div>

          {/* Brief */}
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Brief</div>
            <div className="bidi-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed">
              {task.brief || <span className="text-faint">No brief yet.</span>}
            </div>
          </div>

          {/* Attachments */}
          <TaskAttachments taskId={task.id} />

          {/* Time */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              Time — {formatHours(doneMinutes)} total
            </div>
            <form
              className="mb-2 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const h = parseFloat(timeDraft.hours);
                if (!h || !timeDraft.description.trim()) return;
                addTimeEntry(
                  task.id,
                  Math.round(h * 60),
                  timeDraft.description.trim(),
                  timeDate,
                  timeForUserId ?? undefined, // undefined ⇒ the signed-in user
                );
                setTimeDraft({ hours: "", description: "" });
              }}
            >
              <input
                type="number"
                min={0.25}
                step={0.25}
                required
                placeholder="1.5"
                className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                value={timeDraft.hours}
                onChange={(e) => setTimeDraft((d) => ({ ...d, hours: e.target.value }))}
              />
              <input
                required
                placeholder="What did you do? (required)"
                className="bidi-auto flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                value={timeDraft.description}
                onChange={(e) => setTimeDraft((d) => ({ ...d, description: e.target.value }))}
              />
              {/* Admins log for whoever actually did the work, on whatever day
                  they did it — backfilling forgotten hours is the point.
                  Members can only ever log for themselves today, so they get
                  neither control. */}
              {isAdmin && (
                <>
                  <select
                    value={timeForUserId ?? currentUserId ?? ""}
                    onChange={(e) =>
                      setTimeForUserId(e.target.value === currentUserId ? null : e.target.value)
                    }
                    title="Who these hours are for"
                    className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                  >
                    {timeMembers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === currentUserId ? "Me" : p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={timeDate}
                    onChange={(e) => setTimeDate(e.target.value || toISODate(new Date()))}
                    title="The day these hours were worked"
                    className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                  />
                </>
              )}
              <button className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black">
                Add
              </button>
            </form>
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
              {entries.length === 0 && (
                <div className="px-3 py-2.5 text-sm text-faint">No time logged yet.</div>
              )}
              {entries.map((e) => {
                const user = profiles.find((p) => p.id === e.userId) ?? null;
                // Same as the comments below: a recovered entry names its author in
                // legacy_author_name because that person has no account here.
                const author = user?.name ?? e.legacyAuthorName ?? "";
                return (
                  <div key={e.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(e.id)}
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
            </div>
          </div>

          {/* Comments */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              Discussion
            </div>
            <div className="mb-2 flex flex-col gap-3">
              {taskComments.map((c) => {
                const user = profiles.find((p) => p.id === c.userId) ?? null;
                // An imported pre-Everhour comment usually has no profile — its author
                // left long before the current roster. Without this fallback the name
                // rendered EMPTY on 2,175 of the 2,397 imported comments.
                const author = user?.name ?? c.authorName ?? "";
                return (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar profile={user} size={26} />
                    <div className="min-w-0">
                      <div className="text-xs text-muted">
                        <span className="font-medium text-foreground">{author}</span>{" "}
                        {new Date(c.createdAt).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="bidi-auto text-sm">{c.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!commentDraft.trim()) return;
                addComment(task.id, commentDraft.trim());
                setCommentDraft("");
              }}
            >
              <input
                placeholder="Write a comment…"
                className="bidi-auto flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
                Send
              </button>
            </form>
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
    </>
  );
}
