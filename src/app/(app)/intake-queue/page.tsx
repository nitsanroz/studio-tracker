"use client";

import { useMemo, useState } from "react";
import { useData, type TaskRequest } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { ClientChip } from "@/components/ui";

function ReviewCard({ request }: { request: TaskRequest }) {
  const { clients, projects, sections, profiles, approveRequest, rejectRequest, openTask } =
    useData();
  const [clientId, setClientId] = useState(request.clientId ?? request.suggestedClientId ?? "");
  const [projectId, setProjectId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [title, setTitle] = useState(request.title);
  const [budget, setBudget] = useState(request.budgetHours?.toString() ?? "");
  const [dueDate, setDueDate] = useState(request.requestedDueDate ?? "");
  const [showBrief, setShowBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientProjects = useMemo(
    () => projects.filter((p) => p.clientId === clientId && !p.archived),
    [projects, clientId],
  );
  const effectiveProjectId =
    projectId || (clientProjects.length === 1 ? clientProjects[0].id : "");
  const projectSections = sections.filter((s) => s.projectId === effectiveProjectId);
  const suggested = clients.find((c) => c.id === request.suggestedClientId);

  if (request.status === "approved") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
          approved
        </span>
        <span className="bidi-auto flex-1 truncate font-medium">{request.title}</span>
        {request.createdTaskId && (
          <button
            onClick={() => openTask(request.createdTaskId!)}
            className="text-brand hover:underline"
          >
            Open task →
          </button>
        )}
      </div>
    );
  }
  if (request.status === "rejected") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm opacity-60">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">rejected</span>
        <span className="bidi-auto flex-1 truncate">{request.title}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-brand/30 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bidi-auto w-full rounded-md border border-transparent px-1 py-0.5 text-lg font-semibold hover:border-border focus:border-brand focus:outline-none"
          />
          <p className="mt-0.5 px-1 text-xs text-muted">
            {request.submitterName} &lt;{request.submitterEmail}&gt; ·{" "}
            {formatDate(request.createdAt.slice(0, 10))}
            {suggested && !request.clientId && (
              <> · suggested client: <span className="font-medium text-foreground">{suggested.name}</span></>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowBrief((s) => !s)}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand"
        >
          {showBrief ? "Hide brief" : "Show brief"}
        </button>
      </div>

      {showBrief && (
        <div className="bidi-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed">
          {request.brief}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setProjectId("");
            setSectionId("");
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Client…</option>
          {clients
            .filter((c) => !c.archived)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <select
          value={effectiveProjectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={!clientId}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-40"
        >
          <option value="">Project…</option>
          {clientProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={!effectiveProjectId}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-40"
        >
          <option value="">Section (optional)</option>
          {projectSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Assignee (optional)</option>
          {profiles
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="Budget (h)"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            if (confirm("Reject this submission?")) rejectRequest(request.id);
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:border-danger hover:text-danger"
        >
          Reject
        </button>
        <button
          disabled={busy || !clientId || !effectiveProjectId || !title.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await approveRequest(request.id, {
                clientId,
                projectId: effectiveProjectId,
                sectionId: sectionId || null,
                assigneeId: assigneeId || null,
                title: title.trim(),
                estimateHours: budget === "" ? null : Number(budget),
                dueDate: dueDate || null,
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          {busy ? "Approving…" : "Approve → create task"}
        </button>
      </div>
    </div>
  );
}

export default function IntakeQueuePage() {
  const { taskRequests, clients } = useData();
  const [showHandled, setShowHandled] = useState(false);

  const pending = taskRequests.filter((r) => r.status === "pending");
  const handled = taskRequests.filter((r) => r.status !== "pending");

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl">Intake Queue</h1>
          <p className="text-sm text-muted">
            {pending.length === 0
              ? "No submissions waiting — all clear."
              : `${pending.length} submission${pending.length === 1 ? "" : "s"} waiting for review.`}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showHandled}
            onChange={(e) => setShowHandled(e.target.checked)}
          />
          Show handled
        </label>
      </div>

      {clients.length > 0 && pending.length === 0 && !showHandled && (
        <div className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-faint">
          New client submissions will appear here for review before becoming tasks.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pending.map((r) => (
          <ReviewCard key={r.id} request={r} />
        ))}
        {showHandled && handled.map((r) => <ReviewCard key={r.id} request={r} />)}
      </div>
    </div>
  );
}
