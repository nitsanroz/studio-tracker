"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Link2, MailCheck, Paperclip, Trash2, X } from "lucide-react";
import { useData, useIsAdmin, type TaskRequest } from "@/lib/store";
import { ensureStudioIntakeLink, studioIntakeLinkUrl } from "@/lib/intake-links";
import { formatDate } from "@/lib/format";
import { readSubmission } from "@/lib/brief";
import { isSafeUrl } from "@/lib/links";
import { kindById } from "@/lib/intake-fields";

/** "14:20" — the receipt's timestamp, on the day it matters most. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Drops a submission for good.
 *
 * Hidden from members: `task_requests` is admin-only by RLS, so a member's
 * click would fail at the database anyway — better it isn't offered.
 */
function DeleteRequestButton({ request }: { request: TaskRequest }) {
  const { deleteRequest } = useData();
  const isAdmin = useIsAdmin();
  if (!isAdmin) return null;
  return (
    <button
      onClick={() => {
        if (
          confirm(
            `Delete this submission from ${request.submitterName || "the client"}?\n\n` +
              `"${request.title}"\n\n` +
              // Said plainly, because it's true and there is no undo here.
              (request.createdTaskId
                ? "The task it created stays — only this queue entry goes."
                : "This can't be undone.")
          )
        ) {
          deleteRequest(request.id);
        }
      }}
      title="Delete this submission"
      aria-label="Delete this submission"
      // 44px on a phone — a 27px icon button is not a thumb target, and this
      // one deletes something. Back to a tight icon once there is a pointer.
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger sm:size-7"
    >
      <Trash2 size={15} />
    </button>
  );
}

/**
 * "We've seen it" — the one-click receipt to the client.
 *
 * ⚠️ Deliberately a button and not an on-view side effect. Nitsan asked for the
 * mail to go "once a request is seen by an admin", and firing it on render
 * would mean opening this page to triage one submission quietly emails every
 * other client waiting in the queue. One click keeps the moment the studio's
 * to choose; the card then records it so nobody sends a second.
 */
function NotifyClientButton({ request }: { request: TaskRequest }) {
  const { markRequestSeen } = useData();
  const isAdmin = useIsAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  if (request.clientNotifiedAt) {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted"
        title={`${request.submitterEmail} was told the studio has seen this brief`}
      >
        <MailCheck size={14} className="text-emerald-600" />
        Client notified {timeOf(request.clientNotifiedAt)}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await markRequestSeen(request.id);
          if (!r.ok) setError(r.error ?? "Couldn't send it.");
          setBusy(false);
        }}
        title={`Email ${request.submitterEmail}: someone at the studio has read this brief`}
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50 sm:min-h-0 sm:py-1"
      >
        <MailCheck size={13} />
        {busy ? "Sending…" : "Tell client we've seen it"}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}

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

function ReviewCard({
  request,
  selected,
  onSelect,
}: {
  request: TaskRequest;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const { clients, sections, profiles, approveRequest, rejectRequest, openTask } = useData();
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
  const clientName = clients.find((c) => c.id === (request.clientId ?? request.suggestedClientId))
    ?.name;

  if (request.status !== "pending") {
    const approved = request.status === "approved";
    // ⚠️ A handled row used to show the title and nothing else — no client, no
    // submitter, and no way back to the words the client actually sent. Once
    // the brief is rewritten on the task, this row is the ONLY surviving record
    // of the original, so it has to be able to show it.
    return (
      // ⚠️ A DIV wrapping a button, not a button wrapping everything. The row
      // holds a delete control, and `<button>` inside `<button>` is invalid
      // HTML — the browser re-parents the inner one, which silently broke
      // selection entirely until it was caught in the browser.
      <div
        className={`flex items-center gap-3 rounded-xl border bg-surface text-sm ${
          selected ? "border-brand ring-1 ring-brand" : "border-border"
        } ${approved ? "" : "opacity-60"}`}
      >
        <button
          type="button"
          onClick={() => onSelect?.(request.id)}
          aria-pressed={selected}
          aria-label={`Show the original submission for ${request.title}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-4 text-left hover:text-brand"
        >
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              approved ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            {request.status}
          </span>
          <span className="min-w-0 flex-1">
            <span className="bidi-auto block truncate font-medium">{request.title}</span>
            <span className="block truncate text-xs text-muted">
              {[clientName, request.submitterName, formatDate(request.createdAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </button>
        {request.clientNotifiedAt && (
          <span
            className="shrink-0 text-emerald-600"
            title={`Client notified ${timeOf(request.clientNotifiedAt)}`}
          >
            <MailCheck size={14} aria-label="Client notified" />
          </span>
        )}
        <span className="shrink-0 pr-4">
          <DeleteRequestButton request={request} />
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-brand/30 bg-surface p-4">
      {/* ⚠️ The title and the submitter line get the WHOLE width on a phone.
          Sharing the row with "Show brief" and the delete left them ~230px, so
          the title scrolled inside its own input and the sender's line broke
          after almost every word — "No / Traffic" on two lines.

          Two fixes, and both were needed. The block is `flex-1`, which it never
          was: `min-w-0` alone lets it shrink but never claims the leftover
          space, so the buttons took what they liked ON DESKTOP TOO — that is
          why the title was clipped there as well. And below `sm` the controls
          drop to their own right-aligned row instead of competing for this one. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {/* On a phone the receipt rides up here beside "Show brief" — they
              are the same KIND of thing (something you do while reading the
              submission, not something that resolves it), and it buys the card
              back a whole 44px row. `flex-wrap` is the safety net: if a longer
              client name ever makes the three too wide, it drops to its own
              line rather than pushing the delete off the card.
              From `sm` the footer instance takes over — see there. */}
          <span className="sm:hidden">
            <NotifyClientButton request={request} />
          </span>
          <button
            onClick={() => setShowBrief((s) => !s)}
            className="min-h-11 rounded-full border border-border px-3 text-xs text-muted hover:border-brand hover:text-brand sm:min-h-0 sm:py-1"
          >
            {showBrief ? "Hide brief" : "Show brief"}
          </button>
          <DeleteRequestButton request={request} />
        </div>
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
      {/* The receipt sits at the far left here, pushed by `mr-auto`, because it
          is not part of the approve/reject decision — it's something you do
          while still deciding. ⚠️ `hidden sm:block`: on a phone this instance is
          gone and the one up in the header row is shown instead, so the footer
          is just the two buttons that RESOLVE the card. Two instances rather
          than one moved by CSS because they live in different parents; only one
          is ever rendered visibly, and the route enforces send-once regardless. */}
      <div className="flex items-center justify-end gap-2">
        <div className="mr-auto hidden sm:block">
          <NotifyClientButton request={request} />
        </div>
        <button
          onClick={() => {
            if (confirm("Reject this submission?")) rejectRequest(request.id);
          }}
          className="min-h-11 rounded-lg border border-border px-3 text-sm text-muted hover:border-danger hover:text-danger sm:min-h-0 sm:py-1.5"
        >
          Reject
        </button>
        <button
          disabled={busy || !clientId || !title.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const taskId = await approveRequest(request.id, {
                clientId,
                sectionId: sectionId || null,
                assigneeId: assigneeId || null,
                title: title.trim(),
                estimateHours: budget === "" ? null : Number(budget),
                dueDate: dueDate || null,
              });
              // Straight into the new task. Approving is the middle of a job,
              // not the end of one — there's a type to set, a brief to skim
              // and the client's files now sitting there as links. The pane
              // is mounted app-wide, so it opens over the queue.
              if (taskId) openTask(taskId);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40 sm:min-h-0 sm:py-1.5"
        >
          {busy ? "Approving…" : "Approve → create task"}
        </button>
      </div>
    </div>
  );
}


/** ⚠️ Module scope, not defined inside `SubmissionPane` — a component created
 *  during render is a new type on every render, which remounts its subtree. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="bidi-auto min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * The submission exactly as it arrived, before anyone touched it.
 *
 * ⚠️ This is the ONLY surviving record of the client's own words once the task's
 * brief has been rewritten by hand — `approveRequest` copies a cleaned brief
 * onto the task, and every edit after that overwrites it. `task_requests.brief`
 * is the submission copy, FILES and LINKS blocks included, so it is what the
 * studio saw on the day.
 */
function SubmissionPane({ request, onClose }: { request: TaskRequest; onClose: () => void }) {
  const { clients, openTask } = useData();
  const client = clients.find((c) => c.id === (request.clientId ?? request.suggestedClientId));
  const submission = readSubmission(request.answers);
  const kinds = (submission?.answers.kinds ?? [])
    .map((k) => kindById(k)?.label ?? k)
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-2">
        <h2 className="bidi-auto min-w-0 flex-1 text-base font-medium">{request.title}</h2>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Row label="Client">{client?.name ?? <span className="text-faint">—</span>}</Row>
        <Row label="Submitted by">
          {request.submitterName}
          {request.submitterEmail && (
            <>
              {" "}
              <a href={`mailto:${request.submitterEmail}`} className="text-brand hover:underline">
                {request.submitterEmail}
              </a>
            </>
          )}
        </Row>
        <Row label="Arrived">{formatDate(request.createdAt)}</Row>
        {kinds.length > 0 && <Row label="Kind">{kinds.join(", ")}</Row>}
        {request.seenAt && <Row label="Seen">{formatDate(request.seenAt)}</Row>}
        {request.clientNotifiedAt && (
          <Row label="Client told">{formatDate(request.clientNotifiedAt)}</Row>
        )}
      </div>

      {request.createdTaskId && (
        <button
          onClick={() => openTask(request.createdTaskId!)}
          className="w-fit text-sm text-brand hover:underline"
        >
          Open the task →
        </button>
      )}

      <div>
        <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
          As it arrived
        </span>
        {/* Plain pre-wrap, deliberately: this is a record, not something to
            re-render prettily. It should read exactly as it did on the day. */}
        <div className="bidi-auto max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed">
          {request.brief || <span className="text-faint">No brief was recorded.</span>}
        </div>
      </div>

      {/* ⚠️ Rendered from `answers`, not scraped out of the brief text — the
          URLs are client-supplied, so each is re-checked before it becomes a
          clickable href, exactly as the studio's own link editor does. */}
      {(submission?.files.length || submission?.links.length) ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-faint">Attached</span>
          {submission.files.map((f, i) => (
            <SafeLink key={`f${i}`} url={f.url} label={f.name} icon="file" />
          ))}
          {submission.links.map((l, i) => (
            <SafeLink key={`l${i}`} url={l.url} label={l.title} icon="link" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SafeLink({ url, label, icon }: { url: string; label: string; icon: "file" | "link" }) {
  const Icon = icon === "file" ? Paperclip : Link2;
  if (!isSafeUrl(url)) {
    return (
      <span className="truncate text-sm text-faint line-through" title="Unsafe link">
        <Icon size={12} className="mr-1 inline" />
        {label}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="bidi-auto truncate text-sm text-brand hover:underline"
    >
      <Icon size={12} className="mr-1 inline" />
      {label}
      <ExternalLink size={11} className="ml-1 inline text-faint" />
    </a>
  );
}

export default function IntakeQueuePage() {
  const { taskRequests, clients } = useData();
  const [showHandled, setShowHandled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pending = taskRequests.filter((r) => r.status === "pending");
  const handled = taskRequests.filter((r) => r.status !== "pending");
  // ⚠️ Resolved from the live list, not held as an object: a selected request
  // that gets deleted must drop the pane rather than keep rendering a row that
  // no longer exists.
  const selected = handled.find((r) => r.id === selectedId) ?? null;

  return (
    <div className={`flex flex-col gap-4 ${selected ? "max-w-6xl" : "max-w-3xl"}`}>
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

      {/* ⚠️ The pane is a SIBLING of the list, not an overlay. Below `lg` it
          simply stacks underneath — the queue is admin-only and reviewed on a
          laptop, and a stacked panel is honest on a phone where a fixed
          side-rail would be unusable. Mobile gets its own pass. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {pending.map((r) => (
            <ReviewCard key={r.id} request={r} />
          ))}
          {showHandled &&
            handled.map((r) => (
              <ReviewCard
                key={r.id}
                request={r}
                selected={r.id === selectedId}
                onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
              />
            ))}
          {showHandled && handled.length === 0 && (
            <p className="text-sm text-faint">Nothing handled yet.</p>
          )}
        </div>
        {selected && (
          <aside className="lg:sticky lg:top-4 lg:w-96 lg:shrink-0">
            <SubmissionPane request={selected} onClose={() => setSelectedId(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}
