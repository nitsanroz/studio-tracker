"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "./ui";
import { LinksEditor, type LinksEditorHandle } from "./links-editor";
import type { Task } from "@/lib/types";

/**
 * The brief editor, opened by clicking the Brief box in the task pane.
 *
 * A modal rather than an inline textarea for one reason: briefs are long. The
 * pane is a 576px column with the hours, the time list and the whole comment
 * thread under it, and editing three paragraphs in a box that size means
 * scrolling the page to see what you wrote.
 *
 * Editing rights match migration 0011, which deliberately leaves `brief`
 * member-writable — it's the collaborative field on a task, not a billing one.
 *
 * ⚠️ It opens raised (z-60/70) because the task pane behind it is z-40/50.
 */
export function BriefModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, briefLoaded } = useData();
  const loaded = briefLoaded(task.id);
  const [draft, setDraft] = useState(task.brief);
  const linksRef = useRef<LinksEditorHandle>(null);

  /**
   * ⚠️ ADOPT THE BRIEF WHEN THE LAZY FETCH LANDS — ONCE.
   *
   * `task.brief` is "" for every task until `loadTaskExtras` runs, because the
   * snapshot query doesn't select the column. Seeding `draft` from it at mount
   * is therefore a race: open this modal in the beat before that fetch returns
   * and `draft` was "" FOREVER, because nothing re-seeded it. The `loaded` gate
   * below hides the textarea until the brief arrives — and then showed it EMPTY,
   * over a task with a brief. Closing from there wrote that empty string over
   * real text.
   *
   * Once, and only on the false→true edge: after that `task.brief` can change
   * again from a background refetch of someone else's edit, and adopting THAT
   * would wipe out what the person here is in the middle of typing. Nothing can
   * have been typed before the edge, since the textarea wasn't rendered yet.
   */
  const seeded = useRef(loaded);
  useEffect(() => {
    if (seeded.current || !loaded) return;
    seeded.current = true;
    setDraft(task.brief);
  }, [loaded, task.brief]);

  /**
   * Saves on the way out — including Escape and clicking the backdrop, both of
   * which Modal routes here. Losing a paragraph someone just typed because they
   * hit the wrong key is worse than saving an edit they meant to abandon, and
   * Cmd-Z still undoes the write.
   *
   * ⚠️ AND THAT PROMISE COVERS THE LINK FORM BELOW, which it did not until
   * v1.21.1. The footer says "Saves when you close" and it meant the textarea
   * only: a title and a URL someone had typed into the links editor were thrown
   * away by Escape, a backdrop click, ⌘↵ and the Done button alike — silently,
   * with no row to show for it and nothing in the console. Reported 20 Aug 2026
   * after two Anchor briefs lost their Google Doc link this way.
   */
  function close() {
    linksRef.current?.commitPending();
    if (loaded && draft !== task.brief) updateTask(task.id, { brief: draft });
    onClose();
  }

  return (
    <Modal onClose={close} width="2xl" align="center" layer="raised" labelledBy="brief-modal-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="brief-modal-title" className="font-heading text-sm">
            Brief
          </h3>
          <p className="bidi-auto truncate text-xs text-muted" title={task.title}>
            {task.title}
          </p>
        </div>
        <ModalClose onClose={close} />
      </div>

      {loaded ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) close();
          }}
          placeholder="What needs making, for whom, and anything the designer shouldn't have to ask for…"
          className="bidi-auto h-[45vh] w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-brand"
        />
      ) : (
        // Never let anyone type into an empty box that isn't really empty — the
        // brief column isn't in the snapshot query, so "" here means "not
        // fetched yet", and saving it would erase the real text.
        <div className="flex h-[45vh] items-center justify-center rounded-lg border border-border bg-background text-sm text-faint">
          Loading the brief…
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">Links</div>
        <LinksEditor
          ref={linksRef}
          owner={{ taskId: task.id }}
          canEdit
          emptyHint="No links yet — add a Google Doc, a Dropbox folder, a reference."
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <span className="mr-auto text-xs text-faint">Saves when you close · ⌘↵</span>
        <button
          onClick={close}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
