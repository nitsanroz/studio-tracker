"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Link2, MailCheck, Paperclip, Trash2, X } from "lucide-react";
import { useData, useIsAdmin, type TaskRequest } from "@/lib/store";
import { ensureStudioIntakeLink, studioIntakeLinkUrl } from "@/lib/intake-links";
import { formatDate } from "@/lib/format";
import { readSubmission } from "@/lib/brief";
import { isSafeUrl } from "@/lib/links";
import { kindById } from "@/lib/intake-fields";
import { diffBriefs, needsReview } from "@/lib/brief-diff";
import { ClientChip } from "@/components/ui";

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
/**
 * One added, or one removed, item in the what-changed panel.
 *
 * ⚠️ Files and links draw the SAME row and now do so through the same component.
 * They were two copy-pasted blocks, and they had already drifted: a file checked
 * `isSafeUrl` before rendering an anchor while a link never rendered as one at
 * all, safe or not. One component makes that impossible rather than something a
 * reader has to notice — and the "Add to the task" control exists once, so a
 * change to it cannot land on files and miss links.
 */
function AddedItem({
  url,
  label,
  onAdd,
  already,
}: {
  url: string;
  label: string;
  /** Absent when the brief never became a task — then there is nothing to add to. */
  onAdd?: () => void;
  already: boolean;
}) {
  const safe = isSafeUrl(url);
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="shrink-0 font-semibold text-emerald-600">+</span>
      {safe ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="bidi-auto min-w-0 flex-1 truncate text-base text-brand hover:underline"
        >
          {label}
        </a>
      ) : (
        // Struck through rather than hidden: an admin should see that something
        // arrived and that it is not safe to open.
        <span className="bidi-auto min-w-0 flex-1 truncate text-base line-through">{label}</span>
      )}
      {/* ⚠️ Adding a file or link is the ONE change safe to automate — it takes
          nothing away from what the studio already wrote. Once only. */}
      {onAdd && safe && (
        <button
          type="button"
          disabled={already}
          onClick={onAdd}
          className="min-h-9 shrink-0 rounded-lg border border-border-strong bg-surface px-3 text-sm hover:border-brand disabled:opacity-40"
        >
          {already ? "On the task" : "Add to the task"}
        </button>
      )}
    </div>
  );
}

function RemovedItem({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-muted">
      <span className="shrink-0 font-semibold text-danger">−</span>
      <span className="bidi-auto min-w-0 flex-1 truncate text-base line-through">{label}</span>
      {/* Deliberately no action anywhere on this row: the client withdrawing
          something says nothing about whether the studio should drop what it has. */}
      {note && <span className="shrink-0 text-sm">{note}</span>}
    </div>
  );
}

/**
 * What the client changed since the studio last looked — and the only place a
 * revision can be acted on.
 *
 * ⚠️ THE TASK'S OWN TEXT IS NEVER WRITTEN FROM HERE. Nitsan's requirement:
 * "maybe its an update to text i already refined and rewritten? i want to see
 * what changed and deal with changes with carefulness not erasing edits i
 * already made." So a changed answer is SHOWN, with a copy button, and stays
 * the admin's to fold in by hand. The one thing offered as an action is a NEW
 * FILE, because attaching one is additive — nothing anybody wrote is lost by it.
 */
function WhatChanged({ request }: { request: TaskRequest }) {
  const { markRevisionReviewed, addLink, links, showNotice } = useData();
  const [copied, setCopied] = useState<string | null>(null);
  // Keyed on the two fields it reads, not the whole request — the object gets a
  // fresh identity on every 60-second refresh whatever changed, so a narrow key
  // is the only one that can ever skip the work.
  const diff = useMemo(
    () => diffBriefs(request.answers, request.answersAck),
    [request.answers, request.answersAck],
  );

  /** Already on the task, so a file offered twice can't be added twice. */
  const onTask = useMemo(
    () => new Set(links.filter((l) => l.taskId === request.createdTaskId).map((l) => l.url)),
    [links, request.createdTaskId],
  );

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Safari on an insecure origin, or permission refused mid-gesture.
      showNotice("Couldn't reach the clipboard — select the text and copy it.");
    }
  }

  return (
    <div className="mt-3 rounded-xl border-2 border-brand/40 bg-brand/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-heading text-sm">
          The client changed this{request.editedAt ? ` on ${formatDate(request.editedAt.slice(0, 10))}` : ""}
        </h4>
        <button
          type="button"
          onClick={() => markRevisionReviewed(request.id)}
          className="min-h-9 rounded-lg border border-border-strong bg-surface px-3 text-sm hover:border-brand"
        >
          I&apos;ve read it
        </button>
      </div>

      {/* ⚠️ An old brief has no snapshot to compare against, and an empty diff
          would read as "nothing changed" — the one wrong conclusion here, since
          it invites approving a revision unread. */}
      {diff.noBaseline && (
        <p className="mt-2 text-sm text-muted">
          No earlier version was recorded for this brief, so everything below is shown as new. Read
          the submission itself to be sure.
        </p>
      )}
      {diff.empty && !diff.noBaseline && (
        <p className="mt-2 text-sm text-muted">
          They re-sent it without changing any answer — nothing to reconcile.
        </p>
      )}

      {diff.fields.map((f) => (
        <div key={f.key} className="mt-3 border-t border-brand/20 pt-3 first:border-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</span>
            <button
              type="button"
              onClick={() => copy(f.now, f.key)}
              className="shrink-0 text-sm text-brand hover:underline"
            >
              {copied === f.key ? "Copied" : "Copy new"}
            </button>
          </div>
          {/* Old above, new below, and the old struck through: the shape says
              which is which before a word is read. */}
          <p className="bidi-auto mt-1 whitespace-pre-wrap text-sm text-muted line-through decoration-danger/40">
            {f.was || "(blank)"}
          </p>
          <p className="bidi-auto mt-1 whitespace-pre-wrap text-base">{f.now || "(blank)"}</p>
        </div>
      ))}

      {diff.deliverablesChanged && (
        <div className="mt-3 border-t border-brand/20 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Deliverables</span>
          {diff.deliverablesWas.map((l, i) => (
            <p key={`w${i}`} className="bidi-auto mt-1 text-sm text-muted line-through decoration-danger/40">
              {l}
            </p>
          ))}
          {diff.deliverablesNow.map((l, i) => (
            <p key={`n${i}`} className="bidi-auto mt-1 text-base">
              {l}
            </p>
          ))}
        </div>
      )}

      {(diff.addedFiles.length > 0 || diff.removedFiles.length > 0) && (
        <div className="mt-3 border-t border-brand/20 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Files</span>
          {diff.addedFiles.map((f) => (
            <AddedItem
              key={f.url}
              url={f.url}
              label={f.name}
              onAdd={request.createdTaskId ? () => addLink({ taskId: request.createdTaskId! }, f.name, f.url) : undefined}
              already={onTask.has(f.url)}
            />
          ))}
          {diff.removedFiles.map((f) => (
            <RemovedItem key={f.url} label={f.name} note="they removed this" />
          ))}
        </div>
      )}

      {(diff.addedLinks.length > 0 || diff.removedLinks.length > 0) && (
        <div className="mt-3 border-t border-brand/20 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Links</span>
          {diff.addedLinks.map((l) => (
            <AddedItem
              key={l.url}
              url={l.url}
              label={l.title || l.url}
              onAdd={
                request.createdTaskId
                  ? () => addLink({ taskId: request.createdTaskId! }, l.title || l.url, l.url)
                  : undefined
              }
              already={onTask.has(l.url)}
            />
          ))}
          {diff.removedLinks.map((l) => (
            <RemovedItem key={l.url} label={l.title || l.url} />
          ))}
        </div>
      )}

      {request.createdTaskId && (
        <p className="mt-3 border-t border-brand/20 pt-3 text-sm text-muted">
          This brief is already a task — nothing here changes it until you say so.
        </p>
      )}
    </div>
  );
}

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
  const client = clients.find((c) => c.id === (request.clientId ?? request.suggestedClientId));

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
          {/* ⚠️ A revision of an APPROVED brief is the case Nitsan was most
              worried about — it is already a task he has rewritten — and this
              list is normally COLLAPSED behind "Show handled", so without a
              badge here the update would be invisible until someone went
              looking. It also drives the count on the bell and the home page. */}
          {needsReview(request) && (
            <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
              updated
            </span>
          )}
          {/* Title (with who sent it) on the left, then the client and the date
              as their own columns — they are the two things you scan a handled
              list BY, and stacked under the title they were a run-on line. They
              collapse back under the title below `sm`, where three columns
              would leave the title ~90px. */}
          <span className="grid min-w-0 flex-1 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <span className="min-w-0">
              <span className="bidi-auto block truncate font-medium">{request.title}</span>
              {request.submitterName && (
                <span className="bidi-auto block truncate text-xs text-muted">
                  by {request.submitterName}
                </span>
              )}
            </span>
            {client ? (
              // ⚠️ `link={false}` — this chip sits INSIDE the select button, and
              // an anchor nested in a button is the same invalid nesting that
              // silently broke row selection once already.
              <span className="shrink-0">
                <ClientChip client={client} size="sm" link={false} />
              </span>
            ) : (
              <span />
            )}
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {formatDate(request.createdAt)}
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
          {/* ⚠️ `needsReview`, not `editedAt` — one rule for every status (see
              brief-diff.ts). An edit the admin has already read must stop
              shouting, or the badge becomes wallpaper and the next real revision
              goes unnoticed. */}
          {needsReview(request) && (
            <p className="mt-1 px-1 text-xs font-semibold text-brand">
              ✎ Updated by the client — read the changes below before approving
            </p>
          )}
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

      {/* ⚠️ Above the approve controls, not below them. This is the thing to read
          BEFORE deciding, and a panel under the buttons is one an admin scrolls
          past on the way to clicking Approve. */}
      {needsReview(request) && <WhatChanged request={request} />}

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
        <Row label="Client">
          {client ? <ClientChip client={client} size="sm" /> : <span className="text-faint">—</span>}
        </Row>
        <Row label="Sent by">
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
        {/* ⚠️ Loud, and above "Seen" on purpose: a client can revise a pending
            brief (0029), so an admin who read it yesterday — or already pressed
            "we've seen it" — must be told the words changed rather than working
            from what they remember. */}
        {request.editedAt && (
          <Row label="Edited">
            <span className="font-medium text-brand">
              {formatDate(request.editedAt)} — the client changed this after sending it
            </span>
          </Row>
        )}
        {kinds.length > 0 && <Row label="Kind">{kinds.join(", ")}</Row>}
        {request.seenAt && <Row label="Seen">{formatDate(request.seenAt)}</Row>}
        {request.clientNotifiedAt && (
          <Row label="Client told">{formatDate(request.clientNotifiedAt)}</Row>
        )}
      </div>

      {/* ⚠️ The diff belongs here too, and this is the case that matters most:
          the brief is already a task somebody refined, so "what changed" is the
          only safe way to take a late addition without overwriting their words.
          Above "Open the task", so the changes are read before the task is. */}
      {needsReview(request) && <WhatChanged request={request} />}

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
  const { taskRequests, clients, updatedRequests } = useData();
  const [showHandled, setShowHandled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pending = taskRequests.filter((r) => r.status === "pending");
  const handled = taskRequests.filter((r) => r.status !== "pending");
  /** Handled briefs the client has since changed — see the button below. */
  const revisedHandled = handled.filter((r) => updatedRequests.includes(r)).length;
  // ⚠️ Resolved from the live list, not held as an object: a selected request
  // that gets deleted must drop the pane rather than keep rendering a row that
  // no longer exists.
  const selected = handled.find((r) => r.id === selectedId) ?? null;

  return (
    <div className={`flex flex-col gap-4 ${selected ? "max-w-7xl" : "max-w-3xl"}`}>
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
        {/* With the checkbox gone the header is two items again, so the
            wrap-fighting that `basis-full` used to arbitrate no longer arises. */}
        <div className="shrink-0">
          <CopyFormLinkButton />
        </div>
      </div>

      {clients.length > 0 && pending.length === 0 && !showHandled && (
        <div className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-faint">
          New client submissions will appear here for review before becoming tasks.
        </div>
      )}

      {/* ⚠️ Sits with the LIST, not up in the page header. It changes what the
          list below contains, and a control that far from its effect reads as a
          page-level setting — Nitsan moved it here for that reason. */}
      <label className="flex min-h-11 w-fit items-center gap-1.5 whitespace-nowrap text-sm text-muted sm:min-h-0">
        <input
          type="checkbox"
          checked={showHandled}
          onChange={(e) => setShowHandled(e.target.checked)}
        />
        Show handled
        {handled.length > 0 && <span className="text-faint">({handled.length})</span>}
      </label>

      {/* ⚠️ A revised brief that is ALREADY A TASK hides inside a collapsed list,
          which is the one place an update must not be able to hide — it is the
          case where the studio has already drawn something. So the count is
          stated outside the fold, and the button opens the list rather than
          expecting anyone to find the checkbox. */}
      {!showHandled && revisedHandled > 0 && (
        <button
          type="button"
          onClick={() => setShowHandled(true)}
          className="w-fit rounded-lg border-2 border-brand/40 bg-brand/5 px-4 py-2 text-left text-sm font-medium text-brand hover:bg-brand/10"
        >
          ✎ {revisedHandled} handled {revisedHandled === 1 ? "brief has" : "briefs have"} been
          updated by the client — show {revisedHandled === 1 ? "it" : "them"}
        </button>
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
          <aside className="lg:sticky lg:top-4 lg:w-[22rem] lg:shrink-0 xl:w-[28rem] 2xl:w-[34rem]">
            <SubmissionPane request={selected} onClose={() => setSelectedId(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}
