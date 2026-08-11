"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useData, useIsAdmin, type TaskRequest } from "@/lib/store";
import { ensureStudioIntakeLink, studioIntakeLinkUrl } from "@/lib/intake-links";
import { formatDate } from "@/lib/format";

/** Copies the studio-wide intake form URL, so it can be pasted to a client. */
function CopyFormLinkButton() {
  const isAdmin = useIsAdmin();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefetched on mount so the click can call writeText SYNCHRONOUSLY — Safari
  // drops the clipboard permission as soon as an await intervenes.
  useEffect(() => {
    studioIntakeLinkUrl().then(setUrl).catch(() => {});
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!isAdmin) return null;

  async function copy() {
    setError(null);
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      return;
    }
    const made = await ensureStudioIntakeLink();
    if (!made) {
      setError("Couldn't get a form link — check migration 0003.");
      return;
    }
    setUrl(made);
    await navigator.clipboard.writeText(made);
    setCopied(true);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={copy}
        title="Copy the client intake form link — share it with clients"
        className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand sm:h-8"
      >
        {copied ? <Check size={14} /> : <Link2 size={14} />}
        {/* "Copy" is dropped on a phone — the icon already says it, and the
            shorter label is what keeps this pill on one line beside the
            checkbox. Two spans rather than a JS breakpoint so there is no
            hydration flash of the wrong wording. */}
        {copied ? (
          "Copied ✓"
        ) : (
          <>
            <span className="sm:hidden">Form link</span>
            <span className="hidden sm:inline">Copy form link</span>
          </>
        )}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}

function ReviewCard({ request }: { request: TaskRequest }) {
  const { clients, sections, profiles, approveRequest, rejectRequest, openTask } =
    useData();
  const [clientId, setClientId] = useState(request.clientId ?? request.suggestedClientId ?? "");
  const [sectionId, setSectionId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [title, setTitle] = useState(request.title);
  const [budget, setBudget] = useState(request.budgetHours?.toString() ?? "");
  const [dueDate, setDueDate] = useState(request.requestedDueDate ?? "");
  const [showBrief, setShowBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientSections = useMemo(
    () => sections.filter((s) => s.clientId === clientId),
    [sections, clientId],
  );
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
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={!clientId}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-40"
        >
          <option value="">Section (optional)</option>
          {clientSections.map((s) => (
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
          disabled={busy || !clientId || !title.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await approveRequest(request.id, {
                clientId,
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
      {/* ⚠️ This was one `justify-between` row with no wrap, so at 375px the
          subtitle, the "Show handled" checkbox and the "Copy form link" button
          squeezed each other and every label broke mid-phrase ("Show /
          handled", "Copy / form link"), with the button's text spilling out of
          its own pill.
          The three are now flex SIBLINGS reordered by CSS rather than nested in
          two groups, which is what lets the button ride beside the title on a
          phone without rendering a second copy of it — it prefetches its URL on
          mount, so two instances would mean two fetches.
          Phone: `[title block ………… 🔗 Form link]` then the checkbox wraps
          beneath, pushed right by `ml-auto`. Desktop: `sm:flex-nowrap` plus
          `flex-1` on the title block restores the original single row, with the
          checkbox and button back together on the right in their original
          order (`sm:order-2` / `sm:order-3`). */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          {/* text-xl on a phone: at 2xl "Intake Queue" needs ~200px and the
              button ~150px, which is 7px more than a 375px screen has — so the
              title wrapped mid-name. One step down and both fit on the line. */}
          <h1 className="text-xl sm:text-2xl">Intake Queue</h1>
          <p className="text-sm text-muted">
            {pending.length === 0
              ? "No submissions waiting — all clear."
              : `${pending.length} submission${pending.length === 1 ? "" : "s"} waiting for review.`}
          </p>
        </div>
        {/* ⚠️ `basis-full` below sm is what actually forces the wrap. Without it
            `flex-wrap` never fired: the title block is `flex-1`, so flex shrank
            IT to min-content instead — leaving all three on one line with
            "Intake Queue" broken across two rows. A full basis takes the
            checkbox out of that competition entirely. It sits left on its own
            line, under the subtitle it qualifies. */}
        <label className="order-3 flex min-h-11 shrink-0 basis-full items-center gap-1.5 whitespace-nowrap text-xs text-muted sm:order-2 sm:min-h-0 sm:basis-auto">
          <input
            type="checkbox"
            checked={showHandled}
            onChange={(e) => setShowHandled(e.target.checked)}
          />
          Show handled
        </label>
        <div className="order-2 shrink-0 sm:order-3">
          <CopyFormLinkButton />
        </div>
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
