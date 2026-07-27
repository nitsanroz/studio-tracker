"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * Admin control for the home "Coming up" pane: which groups appear, plus custom
 * dated entries. Birthdays, anniversaries and Jewish holidays are all derived
 * (from member_hr, profiles.start_date and the Hebrew calendar respectively), so
 * they can be switched on and off but have nothing to edit here.
 */

type Group = "birthday" | "anniversary" | "holiday" | "custom";

const GROUP_LABELS: { key: Group; label: string; hint: string }[] = [
  { key: "birthday", label: "Birthdays", hint: "From each member's date of birth" },
  { key: "anniversary", label: "Work anniversaries", hint: "From each member's start date" },
  { key: "holiday", label: "Jewish holidays", hint: "Calculated from the Hebrew calendar" },
  { key: "custom", label: "Custom occasions", hint: "The ones you add below" },
];

type Occasion = { id: string; title: string; date: string; recurring: boolean; icon: string };

export function OccasionsSettings() {
  const [groups, setGroups] = useState<Record<Group, boolean>>({
    birthday: true,
    anniversary: true,
    holiday: true,
    custom: true,
  });
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Set when the occasions table isn't there yet; the group switches still work. */
  const [customUnavailable, setCustomUnavailable] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [icon, setIcon] = useState("📅");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/occasions")
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!alive) return;
        setLoaded(true);
        if (!ok) {
          setError(body.error ?? "Could not load occasions.");
          return;
        }
        setOccasions(body.occasions ?? []);
        setCustomUnavailable(body.customUnavailable ?? null);
        if (body.groups) setGroups((g) => ({ ...g, ...body.groups }));
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  async function saveGroups(next: Record<Group, boolean>) {
    setGroups(next); // optimistic — the toggle should feel instant
    const res = await fetch("/api/occasions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: next }),
    });
    if (!res.ok) setError("Couldn't save which groups are shown.");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/occasions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, date, icon, recurring }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not add that occasion.");
      return;
    }
    setOccasions((list) => [...list, body.occasion].sort((a, b) => a.date.localeCompare(b.date)));
    setTitle("");
    setDate("");
    setIcon("📅");
    setRecurring(false);
  }

  async function remove(id: string) {
    const res = await fetch(`/api/occasions?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not remove that occasion.");
      return;
    }
    setOccasions((list) => list.filter((o) => o.id !== id));
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-heading">Occasions</h2>
      <p className="mb-3 text-sm text-muted">
        What shows in the &ldquo;Coming up&rdquo; pane on everyone&apos;s home page, for the next 30
        days.
      </p>

      {error && <p className="mb-3 rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-col gap-2">
        {GROUP_LABELS.map((g) => (
          <label key={g.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={groups[g.key]}
              onChange={(e) => saveGroups({ ...groups, [g.key]: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{g.label}</span>
              <span className="ml-1.5 text-xs text-muted">{g.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Custom occasions
        </h3>
        {customUnavailable && (
          <p className="mb-2 rounded-lg bg-brand-soft p-2 text-sm text-brand-dark">
            {customUnavailable}
          </p>
        )}
        <div className="flex flex-col divide-y divide-border">
          {occasions.map((o) => (
            <div key={o.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="shrink-0">{o.icon}</span>
              <span className="bidi-auto min-w-0 flex-1 truncate">{o.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {o.recurring ? o.date.slice(5).split("-").reverse().join("/") : o.date}
              </span>
              {o.recurring && (
                <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">
                  yearly
                </span>
              )}
              <button
                onClick={() => remove(o.id)}
                title="Remove"
                className="shrink-0 rounded p-0.5 text-muted hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {loaded && occasions.length === 0 && !error && !customUnavailable && (
            <p className="py-2 text-sm text-faint">
              Nothing custom yet — birthdays, anniversaries and holidays come through on their own.
            </p>
          )}
        </div>

        <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={add}>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            title="Emoji"
            aria-label="Emoji"
            className="w-11 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm outline-none focus:border-brand"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Occasion name…"
            className="min-w-40 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted" title="Repeat every year on this date">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
            />
            Yearly
          </label>
          <button
            disabled={busy || !title.trim() || !date || !!customUnavailable}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>
    </section>
  );
}
