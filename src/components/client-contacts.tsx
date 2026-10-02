"use client";

// The people at a client — who to write to, who signs off.
//
// ⚠️ READ BY EVERYONE, WRITTEN BY ADMINS (0042's `client_contacts`, the one
// lead-era table with `read all`): once a deal is won, the team working the
// client needs these names, which is why "Mark as won" copies the lead's
// contacts here instead of leaving them behind the admin-only pipeline.
//
// ⚠️ FETCHED HERE, NOT IN THE STORE — a handful of rows for one client, read
// only on its Overview tab. `loadClientContacts` returns [] when the table
// does not exist yet, so an unapplied migration costs nothing on this page.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";
import { useIsAdmin } from "@/lib/store";
import { leadForClient, loadClientContacts } from "@/lib/leads/data";
import { addClientContact, removeClientContact, updateClientContact } from "@/lib/leads/actions";
import type { ClientContact } from "@/lib/leads/types";

const QUIET =
  "min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:bg-surface focus:outline-none";

function Field({
  value,
  placeholder,
  onCommit,
  className = "",
}: {
  value: string | null;
  placeholder: string;
  onCommit: (v: string | null) => void;
  className?: string;
}) {
  return (
    <input
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${QUIET} ${className}`}
    />
  );
}

export function ClientContacts({ clientId }: { clientId: string }) {
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<ClientContact[] | null>(null);
  const [fromLead, setFromLead] = useState<{ id: string; company: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await loadClientContacts(clientId));
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [c, l] = await Promise.all([
        loadClientContacts(clientId),
        // Only an admin can read `leads`; for anyone else this is simply null.
        isAdmin ? leadForClient(clientId).catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setRows(c);
      setFromLead(l);
    })();
    return () => {
      alive = false;
    };
  }, [clientId, isAdmin]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change could not be saved.");
    }
  };

  if (rows === null) return null;
  // Members see the card only when there is something on it.
  if (!isAdmin && rows.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Contacts</h2>
        {fromLead && (
          <Link href={`/leads/${fromLead.id}`} className="ml-auto text-[12px] text-muted hover:text-brand">
            From lead →
          </Link>
        )}
      </div>
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="flex flex-col divide-y divide-border/60">
        {rows.map((c) =>
          isAdmin ? (
            <div key={c.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Field
                value={c.name}
                placeholder="Name"
                onCommit={(v) => void run(() => updateClientContact(c.id, { name: v ?? "" }))}
                className="bidi-auto w-40 text-[13.5px] font-medium"
              />
              <Field
                value={c.title}
                placeholder="Title"
                onCommit={(v) => void run(() => updateClientContact(c.id, { title: v }))}
                className="bidi-auto w-36 text-[12.5px] text-muted"
              />
              <span className="flex items-center gap-1">
                <Mail size={12} className="shrink-0 text-faint" />
                <Field
                  value={c.email}
                  placeholder="Email"
                  onCommit={(v) => void run(() => updateClientContact(c.id, { email: v }))}
                  className="w-52 text-[12.5px]"
                />
              </span>
              <span className="flex items-center gap-1">
                <Phone size={12} className="shrink-0 text-faint" />
                <Field
                  value={c.phone}
                  placeholder="Phone"
                  onCommit={(v) => void run(() => updateClientContact(c.id, { phone: v }))}
                  className="w-32 text-[12.5px]"
                />
              </span>
              <button
                onClick={() => {
                  if (window.confirm(`Remove ${c.name}?`)) void run(() => removeClientContact(c.id));
                }}
                aria-label={`Remove ${c.name}`}
                className="ml-auto text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
              {c.notes && <p className="bidi-auto w-full px-1 text-[12px] text-faint">{c.notes}</p>}
            </div>
          ) : (
            <div key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-[13px]">
              <span className="bidi-auto font-medium">{c.name}</span>
              {c.title && <span className="bidi-auto text-muted">{c.title}</span>}
              {c.email && (
                <a href={`mailto:${c.email}`} className="text-muted hover:text-brand">
                  {c.email}
                </a>
              )}
              {c.phone && <span className="text-muted">{c.phone}</span>}
            </div>
          ),
        )}
        {rows.length === 0 && <p className="py-1 text-[12.5px] text-faint">No contacts yet.</p>}
      </div>
      {isAdmin && (
        <button
          onClick={() => void run(() => addClientContact(clientId, "", rows.length + 1))}
          className="mt-2 flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={13} /> Add a contact
        </button>
      )}
    </section>
  );
}
