"use client";

import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "./ui";
import { ClientAvatar } from "./client-avatar";
import { ClientMarkPicker } from "./client-mark-picker";
import type { Client } from "@/lib/types";

/**
 * The client RECORD: its mark, its name, its billing note, and archive.
 *
 * Admin-only, opened by the pencil beside the client's name. Notes and links
 * deliberately are NOT here — they're studio-wide reading and live on the
 * Overview tab (`ClientNotes`), where a member can see them too. Putting them
 * behind an admin button hid the one part of this panel that wasn't admin work.
 *
 * There is no Delete. Deleting a client cascades to its tasks, sections, time
 * entries and published report links — the hours would leave every total in the
 * app with no way back. Archive covers the real case (a client that's finished)
 * and Nitsan chose it deliberately over a typed-confirmation delete.
 */
export function ClientInfoModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { updateClient } = useData();
  const [name, setName] = useState(client.name);
  const [billing, setBilling] = useState(client.billingPeriodNote);

  return (
    <Modal onClose={onClose} width="lg" align="center" labelledBy="client-info-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ClientAvatar client={client} size={28} />
          <div className="min-w-0">
            <h3 id="client-info-title" className="font-heading text-sm">
              Edit client
            </h3>
            <p className="bidi-auto truncate text-xs text-muted">{client.name}</p>
          </div>
        </div>
        <ModalClose onClose={onClose} />
      </div>

      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
        <div className="flex items-start gap-3 text-sm">
          <span className="w-28 shrink-0 pt-1.5 text-muted">Mark</span>
          <ClientMarkPicker client={client} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            // commit on blur, not per keystroke: each write is an undo step
            // and a row update, and nobody wants 14 of them for one rename
            onBlur={() => {
              const v = name.trim();
              if (v && v !== client.name) updateClient(client.id, { name: v });
              else setName(client.name);
            }}
            className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-brand"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-muted">Billing</span>
          <input
            value={billing}
            onChange={(e) => setBilling(e.target.value)}
            onBlur={() => {
              if (billing !== client.billingPeriodNote)
                updateClient(client.id, { billingPeriodNote: billing });
            }}
            placeholder="e.g. Monthly retainer, 40h"
            className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-brand"
          />
        </label>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-muted">Archive</span>
          <button
            onClick={() => updateClient(client.id, { archived: !client.archived })}
            title={
              client.archived
                ? "Restore this client everywhere"
                : "Hide this client from pickers, reports and search — hours are kept"
            }
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${
              client.archived
                ? "border-border bg-surface text-brand hover:border-brand"
                : "border-border bg-surface text-muted hover:border-danger hover:text-danger"
            }`}
          >
            {client.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {client.archived ? "Restore client" : "Archive client"}
          </button>
        </div>
        <p className="mt-1 text-xs text-faint">
          Archiving keeps every hour and report — it only hides the client from pickers, reports and
          search. There is no delete: removing a client would take its tasks and logged hours with
          it. Notes and links are on the Overview tab.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
        <button
          onClick={onClose}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
