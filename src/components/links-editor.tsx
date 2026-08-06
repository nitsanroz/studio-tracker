"use client";

import { useState } from "react";
import { ExternalLink, Link2, Pencil, X } from "lucide-react";
import { useData } from "@/lib/store";
import { hostLabel, isSafeUrl, normalizeUrl } from "@/lib/links";
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
export function LinksEditor({
  owner,
  canEdit,
  emptyHint = "No links yet.",
}: {
  owner: { taskId: string } | { clientId: string };
  canEdit: boolean;
  emptyHint?: string;
}) {
  const { links, addLink, updateLink, deleteLink } = useData();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
                onEdit={() => setEditingId(l.id)}
                onRemove={() => deleteLink(l.id)}
              />
            ),
          )}
        </div>
      )}
      {mine.length === 0 && !adding && <p className="text-sm text-faint">{emptyHint}</p>}
      {canEdit &&
        (adding ? (
          <div className="rounded-lg border border-border">
            <LinkForm
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
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm text-muted hover:bg-background hover:text-brand"
          >
            <Link2 size={14} /> Add link
          </button>
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
          href={link.url}
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
          <button
            onClick={onRemove}
            title="Remove link"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover/link:opacity-100"
          >
            <X size={14} />
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
}: {
  initial?: RefLink;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (title: string, url: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("That doesn't look like a web address.");
      return;
    }
    // An untitled link still needs something to click, so fall back to the host.
    onSubmit(title.trim() || hostLabel(normalized), normalized);
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
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
          onClick={submit}
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
