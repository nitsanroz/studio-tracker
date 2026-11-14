"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, mapLock, type LockRow } from "@/lib/finance/db";
import { isForecastMonth, type FinanceLock } from "@/lib/finance/finance";
import { MONTHS, monthLocked } from "@/lib/finance/plan-model";
import { suggestLines, type LineKind, type Suggestion, type TrackerPerson } from "@/lib/finance/tracker-lines";

/**
 * "New in the tracker" on Salaries and Freelance (v1.15.0, Nitsan 2026-11-05:
 * "anyone that adds up in tracker creates its line in finance… as a suggested
 * line I can approve"). Who is offered is `lib/tracker-lines.ts`.
 *
 * **Add line** makes the person's row the way "Add row" does — linked to their
 * tracker profile, spelled as the tracker has it, ₪0 — but in the month they
 * started rather than January, so the line begins where they do. Nothing is
 * written until the owner presses it: finance data is the owner's.
 *
 * **Not here** stops offering that person on this page — kept in
 * `finance_tracker_ignored` (reference/0017), so on every device; before 0017
 * is run, in this browser only.
 */

const LOCAL = (kind: LineKind) => `finance.trackerLines.ignored.${kind}`;

function readLocal(kind: LineKind): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LOCAL(kind)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function TrackerLines({
  kind,
  table,
  nameColumn,
  amountColumn,
  roleColumn,
  block,
  onAdded,
}: {
  kind: LineKind;
  table: string;
  nameColumn: string;
  amountColumn: string;
  roleColumn?: string;
  block: FinanceLock["block"];
  /** Reload the grid — the new row may be in the year on screen. */
  onAdded: (year: number) => void;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  /** false = 0017 not run: "Not here" lives in this browser. */
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    try {
      const [people, freelancers, lines, ignoredRes] = await Promise.all([
        fetchAll<{ id: string; name: string; active: boolean; has_account: boolean | null; position: string | null; start_date: string | null }>(
          sb,
          "profiles",
          "id, name, active, has_account, position, start_date",
        ),
        sb.from("freelancers").select("profile_id, created_at"),
        fetchAll<Record<string, unknown>>(sb, table, `${nameColumn}, profile_id`),
        sb.from("finance_tracker_ignored").select("profile_id").eq("kind", kind),
      ]);
      // Fail closed: read as "no freelancers", a failed read offered a freelancer (Dima) a Salaries line.
      if (freelancers.error) throw freelancers.error;
      const ignored = readLocal(kind);
      if (ignoredRes.error) setShared(false);
      else for (const r of ignoredRes.data ?? []) ignored.add(r.profile_id as string);
      setItems(
        suggestLines(
          kind,
          people.map(
            (p): TrackerPerson => ({
              id: p.id,
              name: p.name,
              active: p.active,
              hasAccount: p.has_account !== false,
              position: p.position,
              startDate: p.start_date,
            }),
          ),
          (freelancers.data ?? []).map((f) => ({ profileId: f.profile_id as string, createdAt: String(f.created_at) })),
          lines.map((l) => ({ name: String(l[nameColumn] ?? ""), profileId: (l.profile_id as string | null) ?? null })),
          ignored,
        ),
      );
    } catch {
      // Best effort: a failed look never gets in the way of the page.
      setItems([]);
    }
  }, [kind, table, nameColumn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items.length) return null;

  const add = async (s: Suggestion) => {
    setBusy(s.profileId);
    setNote(null);
    const sb = createClient();
    const { data: lockRows, error: lockErr } = await sb
      .from("finance_locks")
      .select("id, scope_year, scope_month, block, locked_at, note")
      .eq("scope_year", s.year);
    // Fail closed: a failed lock read used to count as "nothing locked" and insert anyway.
    if (lockErr) {
      setNote(`Couldn't check whether ${MONTHS[s.month - 1]} ${s.year} is locked — try again.`);
      setBusy(null);
      return;
    }
    if (monthLocked(((lockRows ?? []) as LockRow[]).map(mapLock), s.year, s.month, block)) {
      setNote(`${MONTHS[s.month - 1]} ${s.year} is locked — reopen it, or add ${s.name} with "Add row".`);
      setBusy(null);
      return;
    }
    const payload: Record<string, unknown> = {
      [nameColumn]: s.name,
      profile_id: s.profileId,
      year: s.year,
      month: s.month,
      [amountColumn]: 0,
      state: isForecastMonth(s.year, s.month) ? "predicted" : "actual",
    };
    if (roleColumn) payload[roleColumn] = "";
    const { error } = await sb.from(table).insert(payload);
    setBusy(null);
    if (error) {
      setNote(`Couldn't add ${s.name}: ${error.message}`);
      return;
    }
    setItems((xs) => xs.filter((x) => x.profileId !== s.profileId));
    onAdded(s.year);
  };

  const dismiss = async (s: Suggestion) => {
    setItems((xs) => xs.filter((x) => x.profileId !== s.profileId));
    if (shared) {
      const { error } = await createClient()
        .from("finance_tracker_ignored")
        .upsert({ profile_id: s.profileId, kind }, { onConflict: "profile_id,kind" });
      if (!error) return;
    }
    try {
      localStorage.setItem(LOCAL(kind), JSON.stringify([...readLocal(kind), s.profileId]));
    } catch {
      // ignore — they'll be offered again next time
    }
  };

  return (
    <section className="mb-3 rounded-lg border border-dashed border-brand/40 bg-surface px-4 py-3 text-sm">
      <h2 className="flex items-center gap-1.5 font-medium text-foreground">
        <UserPlus size={15} className="text-brand" aria-hidden />
        New in the tracker
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        {kind === "freelance"
          ? "Freelancers the tracker has with no line here yet."
          : "Team members with a login and no line here yet."}{" "}
        Add line starts their row at ₪0 in the month they started.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {items.map((s) => (
          <li key={s.profileId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
            <span className="min-w-0">
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 text-xs text-muted">
                from {MONTHS[s.month - 1]} {s.year}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <button
                disabled={busy !== null}
                onClick={() => void add(s)}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy === s.profileId ? "Adding…" : "Add line"}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => void dismiss(s)}
                title={kind === "freelance" ? "Not a freelancer finance pays" : "Not on the payroll"}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
              >
                Not here
              </button>
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-xs text-danger">{note}</p>}
      {!shared && <p className="mt-1 text-[11px] text-faint">&ldquo;Not here&rdquo; is kept in this browser until reference/0017 is run.</p>}
    </section>
  );
}
