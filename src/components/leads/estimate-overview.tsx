"use client";

// The estimate's Overview tab — the client page's Overview in miniature, so it
// can be carried across when the lead becomes a client (0049): notes + links in
// the main column, contacts under them, the figures in a sidebar.
//
// ⚠️ Notes and links are internal and are NOT locked by approval (see
// `updateEstimateOverview`) — the scope and its prices are.

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { updateEstimateOverview, type EstimateDetail } from "@/lib/leads/estimates-data";
import { fmtHours, fmtNis, type Totals } from "@/lib/leads/estimate";
import { hostLabel, isSafeUrl, normalizeUrl } from "@/lib/links";
import type { LeadContact } from "@/lib/leads/types";

const CARD = "rounded-2xl border border-border bg-surface p-4 shadow-card";

export function EstimateOverview({
  detail,
  t,
  contacts,
  leadId,
  run,
}: {
  detail: EstimateDetail;
  t: Totals;
  contacts: LeadContact[];
  leadId: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const e = detail.estimate;
  const [notes, setNotes] = useState(e.notes ?? "");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState(false);
  const phases = [...detail.phases].sort((a, b) => a.position - b.position);

  const addLink = () => {
    const u = normalizeUrl(url);
    if (!u) {
      setBad(true);
      return;
    }
    const next = [...e.links, { title: title.trim() || hostLabel(u), url: u }];
    setTitle("");
    setUrl("");
    setBad(false);
    void run(() => updateEstimateOverview(e.id, { links: next }));
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[7fr_3fr]">
      <div className="flex flex-col gap-4">
        <section className={CARD}>
          <h2 className="mb-2 text-sm font-semibold">Notes</h2>
          <textarea
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            onBlur={() => {
              const v = notes.trim() || null;
              if (v !== (e.notes ?? null)) void run(() => updateEstimateOverview(e.id, { notes: v }));
            }}
            placeholder="Standing context for this client — tone of voice, who signs off, where the assets live… Carried to the client page on conversion."
            className="bidi-auto h-32 w-full resize-y rounded-lg border border-transparent bg-background px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors hover:border-border focus:border-brand"
          />
        </section>

        <section className={CARD}>
          <h2 className="mb-2 text-sm font-semibold">Links</h2>
          {e.links.length === 0 && <p className="mb-2 text-[13px] text-faint">No links yet — a brand book, a shared drive, the contract.</p>}
          <ul className="flex flex-col gap-1">
            {e.links.map((l, i) => (
              <li key={`${l.url}-${i}`} className="group flex items-center gap-2 text-[13px]">
                {isSafeUrl(l.url) ? (
                  <a href={l.url} target="_blank" rel="noreferrer" className="bidi-auto min-w-0 truncate text-brand hover:underline">
                    {l.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-faint line-through" title="Not a safe link">
                    {l.title}
                  </span>
                )}
                <button
                  onClick={() => void run(() => updateEstimateOverview(e.id, { links: e.links.filter((_, j) => j !== i) }))}
                  aria-label={`Remove ${l.title}`}
                  className="ml-auto text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              addLink();
            }}
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <input
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder="Title"
              className="bidi-auto h-8 w-40 rounded-md border border-border bg-surface px-2 text-[13px]"
            />
            <input
              value={url}
              onChange={(ev) => {
                setUrl(ev.target.value);
                setBad(false);
              }}
              placeholder="https://…"
              className={`h-8 min-w-0 flex-1 rounded-md border bg-surface px-2 text-[13px] ${bad ? "border-danger" : "border-border"}`}
            />
            <button type="submit" disabled={!url.trim()} className="h-8 rounded-md bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40">
              Add link
            </button>
          </form>
        </section>

        <section className={CARD}>
          <div className="mb-2 flex items-center">
            <h2 className="text-sm font-semibold">Contacts</h2>
            <Link href={`/leads/${leadId}`} className="ml-auto text-[12px] text-muted hover:text-foreground">
              Edit on the lead →
            </Link>
          </div>
          {contacts.length === 0 ? (
            <p className="text-[13px] text-faint">No contacts on this lead yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-[13px]">
                  <span className="bidi-auto font-medium">{c.name}</span>
                  {c.title && <span className="bidi-auto text-muted">{c.title}</span>}
                  {c.email && <span className="text-muted">{c.email}</span>}
                  {c.phone && <span className="text-muted">{c.phone}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className={`${CARD} lg:sticky lg:top-4`}>
        <h2 className="mb-2 text-sm font-semibold">Scope</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
          {phases.map((p) => {
            const h = t.phase.get(p.id) ?? { min: 0, max: 0 };
            return (
              <div key={p.id} className="contents">
                <dt className="bidi-auto truncate text-muted">{p.name}</dt>
                <dd className="text-right">{fmtHours(h)}</dd>
              </div>
            );
          })}
          <dt className="border-t border-border pt-1.5 font-medium">Total</dt>
          <dd className="border-t border-border pt-1.5 text-right font-medium">{fmtHours(t.totalHours)}</dd>
          <dt className="text-muted">Before VAT</dt>
          <dd className="text-right">{fmtNis(t.net)}</dd>
          <dt className="text-faint">Items · groups</dt>
          <dd className="text-right text-faint">
            {detail.lines.length} · {detail.groups.length}
          </dd>
        </dl>
      </aside>
    </div>
  );
}
