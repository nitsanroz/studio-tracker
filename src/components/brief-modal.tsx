"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "./ui";
import { LinksEditor } from "./links-editor";
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

  /**
   * Saves on the way out — including Escape and clicking the backdrop, both of
   * which Modal routes here. Losing a paragraph someone just typed because they
   * hit the wrong key is worse than saving an edit they meant to abandon, and
   * Cmd-Z still undoes the write.
   */
  function close() {
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
