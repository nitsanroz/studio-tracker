"use client";

import { useEffect, useState } from "react";
import { useData, useIsAdmin } from "@/lib/store";
import { LinksEditor } from "./links-editor";
import type { Client } from "@/lib/types";

/**
 * The client's standing context — notes and reference links — on the Overview
 * tab, where everyone can read it.
 *
 * It used to sit inside the admin-only Client info modal, which meant the one
 * part of that panel intended for the whole studio was behind a button members
 * had no reason to press. The edit button now covers the client RECORD only.
 *
 * Admins edit in place. Unlike the modal there is no "close" to hang a save on,
 * so notes commit on blur — one write per visit to the field, rather than one
 * per keystroke, and no Save button to forget.
 */
export function ClientNotes({ client }: { client: Client }) {
  const { updateClient } = useData();
  const isAdmin = useIsAdmin();
  const [notes, setNotes] = useState(client.notes);

  // A background refresh (or another admin) can change the notes under us. Only
  // adopt the incoming value — never clobber what someone is part-way through
  // typing, which is why this keys on the STORED value, not on every render.
  useEffect(() => {
    setNotes(client.notes);
  }, [client.notes]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold">Notes</h2>
        {isAdmin ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== client.notes) updateClient(client.id, { notes });
            }}
            placeholder="Standing context for this client — tone of voice, who signs off, where the assets live…"
            className="bidi-auto h-32 w-full resize-y rounded-lg border border-transparent bg-background px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors hover:border-border focus:border-brand"
          />
        ) : (
          <div className="bidi-auto whitespace-pre-wrap rounded-lg bg-background px-3 py-2.5 text-sm leading-relaxed">
            {client.notes || <span className="text-faint">No notes yet.</span>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold">Links</h2>
        <LinksEditor
          owner={{ clientId: client.id }}
          canEdit={isAdmin}
          emptyHint="No links yet — a brand book, a shared drive, the contract."
        />
      </section>
    </div>
  );
}
