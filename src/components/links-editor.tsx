"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { ExternalLink, Link2, Pencil, Trash2 } from "lucide-react";
import { useData } from "@/lib/store";
import { hostLabel, isSafeUrl, normalizeUrl } from "@/lib/links";
import { proxyStorageUrl } from "@/lib/storage-url";
import type { Link as RefLink } from "@/lib/types";

/**
 * Titled reference links for one task or one client (migration 0022).
 *
 * Only the TITLE is rendered — that's the whole point. The studio's links are
 * Google Doc and Dropbox URLs that run to 200 unreadable characters, so today
 * they get pasted into the brief and turn it into noise. "Client branding
 * questionnaire" is what a person needs to see.
 *
 * Because the title is all you see, the URL behind it is checked before it is
 * ever stored (`normalizeUrl`) and again before it is rendered (`isSafeUrl`):
 * a `javascript:` link under a friendly title is a trap nobody could spot.
 */
export interface LinksEditorHandle {
  /** open the add form — for callers that host their own "+ Add link" control */
  startAdding: () => void;
  /**
   * Commit whatever is typed into the open add/edit form, if it amounts to a
   * usable link. For hosts that save on the way out — see the ⚠️ note on
   * `LinkForm.commit`, and `BriefModal.close`, which is why this exists.
   */
  commitPending: () => void;
}

/** What `LinksEditor` needs from the one form that may be open. */
interface LinkFormHandle {
  commit: () => void;
}

export function LinksEditor({
  owner,
  canEdit,
  emptyHint = "No links yet.",
  showAddButton = true,
  ref,
}: {
  owner: { taskId: string } | { clientId: string };
  canEdit: boolean;
  emptyHint?: string;
  /** false when the surrounding heading provides the add control instead */
  showAddButton?: boolean;
  ref?: Ref<LinksEditorHandle>;
}) {
  const { links, addLink, updateLink, deleteLink } = useData();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * The one form that may be open. Add and edit are mutually exclusive below
   * precisely so this can be a single ref: `commitPending` has to reach whatever
   * is on screen, and two of them would mean guessing which.
   */
  const formRef = useRef<LinkFormHandle | null>(null);

  const openAdd = () => {
    setEditingId(null);
    setAdding(true);
  };

  useImperativeHandle(
    ref,
    () => ({ startAdding: openAdd, commitPending: () => formRef.current?.commit() }),
    [],
  );

  const mine = links
    .filter((l) => ("taskId" in owner ? l.taskId === owner.taskId : l.clientId === owner.clientId))
    .sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-1.5">
      {mine.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {mine.map((l) =>
            editingId === l.id ? (
              <LinkForm
                key={l.id}
                ref={formRef}
                initial={l}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(title, url) => {
                  updateLink(l.id, { title, url });
                  setEditingId(null);
                }}
              />
            ) : (
              <LinkRow
                key={l.id}
                link={l}
                canEdit={canEdit}
                onEdit={() => {
                  setAdding(false);
                  setEditingId(l.id);
                }}
                onRemove={() => deleteLink(l.id)}
              />
            ),
          )}
        </div>
      )}
      {mine.length === 0 && !adding && showAddButton && (
        <p className="text-sm text-faint">{emptyHint}</p>
      )}
      {canEdit &&
        (adding ? (
          <div className="rounded-lg border border-border">
            <LinkForm
              ref={formRef}
              submitLabel="Add link"
              autoFocus
              onCancel={() => setAdding(false)}
              onSubmit={(title, url) => {
                addLink(owner, title, url);
                setAdding(false);
              }}
            />
          </div>
        ) : (
          showAddButton && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm text-muted hover:bg-background hover:text-brand"
            >
              <Link2 size={14} /> Add link
            </button>
          )
        ))}
    </div>
  );
}

function LinkRow({
  link,
  canEdit,
  onEdit,
  onRemove,
}: {
  link: RefLink;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const safe = isSafeUrl(link.url);
  return (
    <div className="group/link flex items-center gap-2.5 px-3 py-2 text-sm">
      <ExternalLink size={13} className="shrink-0 text-faint" />
      {safe ? (
        <a
          // An approved brief's attachments become real `links` rows, so a row here
          // can point at the private intake bucket — see `proxyStorageUrl`.
          href={proxyStorageUrl(link.url)}
          target="_blank"
          rel="noreferrer noopener"
          title={link.url}
          className="bidi-auto min-w-0 flex-1 truncate font-medium text-brand hover:underline"
        >
          {link.title || hostLabel(link.url)}
        </a>
      ) : (
        // Refuse to render it as a link rather than silently dropping the row —
        // an admin needs to see that something unusable is stored here.
        <span
          className="bidi-auto min-w-0 flex-1 truncate text-muted line-through"
          title="This link isn't a normal web address, so it isn't clickable"
        >
          {link.title || link.url}
        </span>
      )}
      {canEdit && (
        <>
          <button
            onClick={onEdit}
            title="Edit link"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-brand group-hover/link:opacity-100"
          >
            <Pencil size={13} />
          </button>
          {/* A trash, not an ×: this deletes the link, and an × beside a row
              reads as "close" or "dismiss" — the one thing it doesn't do. */}
          <button
            onClick={onRemove}
            title="Delete link"
            aria-label="Delete link"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover/link:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}

function LinkForm({
  initial,
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
  ref,
}: {
  initial?: RefLink;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (title: string, url: string) => void;
  onCancel: () => void;
  ref?: Ref<LinkFormHandle>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  /**
   * ⚠️ Commit ONCE per form, whoever asks — and two things can ask. Escape
   * closes this form here, and if that keydown still reaches the `window`
   * listener `Modal` registers it also closes the host modal, whose own close
   * handler calls `commitPending()`. Without this guard those two paths insert
   * the same link twice.
   */
  const done = useRef(false);

  /**
   * ⚠️ `silent` is the on-the-way-out call (`commit`), and it must never block
   * anything: there is no form left to show a message in. An unusable URL there
   * is someone who typed a title and changed their mind — nothing storable, and
   * `url` is NOT NULL, so there is no half-row to keep either.
   */
  function submit(opts: { silent?: boolean } = {}) {
    if (done.current) return;
    const normalized = normalizeUrl(url);
    if (!normalized) {
      if (!opts.silent) setError("That doesn't look like a web address.");
      return;
    }
    done.current = true;
    // An untitled link still needs something to click, so fall back to the host.
    onSubmit(title.trim() || hostLabel(normalized), normalized);
  }

  // No deps array on purpose: `submit` closes over `title`/`url`, and a `[]`
  // handle would commit whatever was typed on the FIRST render — i.e. nothing.
  useImperativeHandle(ref, () => ({ commit: () => submit({ silent: true }) }));

  return (
    <div
      className="flex flex-col gap-1.5 p-2"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Escape here means "done with this little form", not "throw away the
        // whole brief modal" — `Modal` listens on `window`, so the native event
        // has to be stopped before it gets there. ⚠️ Measured rather than
        // assumed: React's root container in this app is `document` (App Router
        // hydrates the whole document), which sits BELOW `window` on the bubble
        // path, so React's synthetic `stopPropagation` really does shield that
        // listener. It still SAVES either way — the same rule the brief textarea
        // follows, and `done` above is what keeps the belt-and-braces path from
        // inserting twice if a future React ever attaches somewhere else.
        e.stopPropagation();
        submit({ silent: true });
        onCancel();
      }}
    >
      <input
        autoFocus={autoFocus}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Title — e.g. Client branding questionnaire"
        className="bidi-auto w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="https://docs.google.com/…"
        dir="ltr"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => submit()}
          className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
        >
          {submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-background">
          Cancel
        </button>
      </div>
    </div>
  );
}
