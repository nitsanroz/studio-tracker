"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { presetRange } from "@/lib/date-ranges";
import { formatHoursShort, toISODate, MONTH_NAMES_SHORT } from "@/lib/format";
import { bucketProjection } from "@/lib/period-math";
import { useMemberEmails } from "@/lib/use-member-emails";
import { ClientChip, Tabs, TagBadge } from "@/components/ui";
import { PictureEditBadge } from "@/components/picture-editor";
import { HBar, MultiLineChart } from "@/components/charts";
import type { Role } from "@/lib/types";

function NotesField({ profileId }: { profileId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [value, setValue] = useState<string | null>(null);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const dirty = value !== savedValue;

  useEffect(() => {
    supabase
      .from("member_notes")
      .select("notes")
      .eq("profile_id", profileId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("notes load failed", error.message);
        setValue(data?.notes ?? "");
        setSavedValue(data?.notes ?? "");
      });
  }, [supabase, profileId]);

  async function save() {
    const { error } = await supabase
      .from("member_notes")
      .upsert({ profile_id: profileId, notes: value, updated_at: new Date().toISOString() });
    if (error) console.error("notes save failed", error.message);
    else setSavedValue(value);
  }

  if (value === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted">Notes (admins only)</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Contract details, reviews, reminders…"
        className="bidi-auto w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      {dirty && (
        <button
          onClick={save}
          className="self-end rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark"
        >
          Save notes
        </button>
      )}
    </div>
  );
}

/** Private HR sheet fields — admin-only table (member_hr), quiet inline inputs. */
const HR_FIELDS = [
  ["national_id", "National ID (ת.ז.)"],
  ["gender", "Gender"],
  ["birth_date", "Birth date"],
  ["personal_email", "Personal email"],
  ["phone", "Mobile"],
  ["street", "Street"],
  ["house_no", "House no."],
  ["floor", "Floor"],
  ["apartment", "Apartment"],
  ["city", "City"],
  ["zip", "Zip"],
  ["marital_status", "Marital status"],
  ["emergency_contact_name", "Emergency contact"],
  ["emergency_contact_phone", "Contact phone"],
] as const;
type HrKey = (typeof HR_FIELDS)[number][0];
type HrRow = Partial<Record<HrKey, string | number | null>>;

function HrFields({ profileId }: { profileId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<HrRow | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("member_hr")
      .select("*")
      .eq("profile_id", profileId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("hr load failed", error.message);
          setRow({});
          return;
        }
        setRow((data as HrRow) ?? {});
      });
  }, [supabase, profileId]);

  async function saveField(key: HrKey, raw: string) {
    const value = raw === "" ? null : raw;
    if ((row?.[key] ?? null) === value) return;
    setRow((r) => ({ ...r, [key]: value }));
    const { error } = await supabase
      .from("member_hr")
      .upsert({ profile_id: profileId, [key]: value, updated_at: new Date().toISOString() });
    if (error) console.error("hr save failed", error.message);
    else {
      setSavedAt(key);
      setTimeout(() => setSavedAt(null), 1500);
    }
  }

  if (row === null) return null;

  // age + derived hints
  const birth = row.birth_date ? String(row.birth_date) : null;
  const age = birth
    ? Math.floor((Date.now() - new Date(birth).getTime()) / (365.25 * 86400000))
    : null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
        Personal details (admins only){age != null && <span className="ml-2 normal-case">· age {age}</span>}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {HR_FIELDS.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-[11px] font-medium text-muted">
            <span>
              {label}
              {savedAt === key && <span className="ml-1 text-success">✓</span>}
            </span>
            <input
              type={key === "birth_date" ? "date" : "text"}
              defaultValue={row[key] == null ? "" : String(row[key])}
              onBlur={(e) => saveField(key, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="bidi-auto rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal text-foreground outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The member's open assigned tasks. Independent of the period selector on
 * purpose — "what are they carrying right now" is not a question about a date
 * range, and every other pane here is scoped, so the subtitle says so.
 *
 * Deliberately NOT the shared TaskTable: its "by me" column keys off the VIEWING
 * admin (so on someone else's page it reports the wrong person's hours), it
 * measures 800px+ in a half-width pane, and it is a full inline editor on a page
 * meant to read a person's record.
 */
function OpenTasksPane({ profileId }: { profileId: string }) {
  const { tasks, clients, openTask } = useData();
  const todayIso = toISODate(new Date());
  const open = tasks
    .filter((t) => t.assigneeId === profileId && t.status !== "done")
    .sort(
      (a, b) =>
        (a.dueDate ? 0 : 1) - (b.dueDate ? 0 : 1) ||
        (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
        a.position - b.position,
    );

  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-faint">
        Open tasks ({open.length})
      </h2>
      <p className="mb-2 text-[11px] text-faint">open now — not scoped to a period</p>
      <div className="flex max-h-[300px] flex-col divide-y divide-border overflow-y-auto">
        {open.map((t) => {
          const client = clients.find((c) => c.id === t.clientId);
          const overdue = t.dueDate != null && t.dueDate < todayIso;
          return (
            <button
              key={t.id}
              onClick={() => openTask(t.id)}
              className="flex items-center gap-2 py-2 text-left text-sm hover:bg-background"
            >
              {/* link={false}: an <a> cannot nest inside this button */}
              {client && (
                <span className="max-w-32 shrink-0 truncate">
                  <ClientChip client={client} size="sm" link={false} />
                </span>
              )}
              <span className="bidi-auto min-w-0 flex-1 truncate">{t.title}</span>
              {t.tag && <TagBadge tag={t.tag} />}
              {t.dueDate && (
                <span
                  className={`shrink-0 text-xs tabular-nums ${overdue ? "text-danger" : "text-muted"}`}
                >
                  {t.dueDate.slice(5)}
                </span>
              )}
            </button>
          );
        })}
        {open.length === 0 && <p className="py-2 text-sm text-faint">No open tasks assigned.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function MemberPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = use(params);
  const { profiles, tasks, clients, entrySumsAll, updateProfile } = useData();
  const isAdmin = useIsAdmin();
  const profile = profiles.find((p) => p.id === profileId);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "hr">("overview");
  /**
   * Lazily mounted, then never unmounted — see the HR block below. Never
   * persisted and never deep-linked either: a URL or a sticky preference that
   * lands you on a sheet of national IDs every visit is the wrong default.
   */
  const [hrMounted, setHrMounted] = useState(false);
  useEffect(() => {
    if (tab === "hr") setHrMounted(true);
  }, [tab]);
  const email = useMemberEmails(isAdmin)[profileId];

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Includes recovered pre-Everhour entries: this page IS the person's history.
  const mine = useMemo(
    () => entrySumsAll.filter((e) => e.userId === profileId),
    [entrySumsAll, profileId],
  );

  // ── stats ──
  const month = useMemo(() => presetRange("This month"), []);
  const monthMinutes = mine.reduce(
    (s, e) => (e.date >= month.from && e.date <= month.to ? s + e.minutes : s),
    0,
  );
  const billableTaskIds = useMemo(
    () => new Set(tasks.filter((t) => t.billable).map((t) => t.id)),
    [tasks],
  );
  const monthBillable = mine.reduce(
    (s, e) =>
      e.date >= month.from && e.date <= month.to && billableTaskIds.has(e.taskId)
        ? s + e.minutes
        : s,
    0,
  );
  const totalMinutes = mine.reduce((s, e) => s + e.minutes, 0);

  // ── hours per month ──
  // Windowed on this person's last 12 months OF ACTIVITY, not the last 12 calendar
  // months. Former staff recovered from the pre-Everhour history last logged in
  // 2019–2022, so a fixed recent window rendered their chart completely empty.
  const perMonth = useMemo(() => {
    const latest = mine.reduce((max, e) => (e.date > max ? e.date : max), "");
    const anchor = latest
      ? new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, 1)
      : new Date();
    const buckets: { key: string; label: string; minutes: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        // Show the year whenever the window isn't the current one — otherwise a
        // 2019 chart reads as if it were this year.
        label:
          d.getMonth() === 0 || d.getFullYear() !== new Date().getFullYear()
            ? `${MONTH_NAMES_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
            : MONTH_NAMES_SHORT[d.getMonth()],
        minutes: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const e of mine) {
      const b = byKey.get(e.date.slice(0, 7));
      if (b) b.minutes += e.minutes;
    }
    return buckets;
  }, [mine]);

  /**
   * Dash the running month as a projection, the same way the admin home does.
   * Safe by construction for former staff: bucketProjection returns null unless
   * the last bucket IS the current month, and an ex-employee's window ends years
   * ago — so their chart is never drawn as an estimate.
   */
  const projection = useMemo(() => {
    const last = perMonth.at(-1);
    if (!last) return null;
    const f = bucketProjection("month", last.key);
    return f == null
      ? null
      : { index: perMonth.length - 1, values: [Math.round(last.minutes * f)] };
  }, [perMonth]);

  // ── most active clients, all time ──
  const { topClients, clientCount } = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of mine) {
      const task = taskById.get(e.taskId);
      if (!task) continue;
      map.set(task.clientId, (map.get(task.clientId) ?? 0) + e.minutes);
    }
    const all = [...map.entries()]
      .map(([clientId, minutes]) => ({ client: clientById.get(clientId), minutes }))
      .filter((r) => r.client)
      .sort((a, b) => b.minutes - a.minutes);
    return { topClients: all.slice(0, 8), clientCount: all.length };
  }, [mine, taskById, clientById]);

  if (!isAdmin) return <p className="text-sm text-muted">This page is for admins only.</p>;
  if (!profile) return <p className="text-sm text-muted">Member not found.</p>;

  // Goes through /api/admin/invite, not supabase.auth.resetPasswordForEmail():
  // the browser call mints a PKCE link that only opens in THIS browser, so a link
  // mailed to a member never worked on their own device. See the route for detail.
  async function sendReset() {
    setResetStatus("…");
    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: profile!.id }),
    });
    const body = await res.json().catch(() => ({}));
    setResetStatus(res.ok ? `Link sent to ${body.email} ✓` : (body.error ?? "Could not send."));
  }

  const maxClient = topClients[0]?.minutes ?? 0;

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <Link
        href="/team"
        className="flex items-center gap-1 text-sm text-muted hover:text-brand"
      >
        <ArrowLeft size={14} /> Team
      </Link>

      {!profile.active && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted shadow-card">
          <Archive size={14} />
          <span>
            <span className="font-medium text-foreground">{profile.name}</span> is archived
            {profile.endDate ? ` — last day ${profile.endDate}` : ""} — hidden from the team list,
            assignee pickers and the weekly plan. All logged hours are kept.
          </span>
        </div>
      )}

      {/* Both pictures live in the header with a pencil badge each — they used to
          get a whole titled pane below the stats, which was more chrome than two
          thumbnails deserve. */}
      <div className={`flex flex-wrap items-center gap-3 ${profile.active ? "" : "opacity-70"}`}>
        <PictureEditBadge profile={profile} kind="avatar" size={56} />
        <PictureEditBadge profile={profile} kind="photo" size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl">{profile.name}</h1>
          <p className="text-sm capitalize text-muted">
            {profile.role}
            {email ? <span className="normal-case"> · {email}</span> : null}
          </p>
        </div>
        <select
          value={profile.role}
          onChange={(e) => updateProfile(profile.id, { role: e.target.value as Role })}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="designer">designer</option>
          <option value="admin">admin</option>
        </select>
        {/* Reads as a control, not a status label — it used to be a coloured pill
            saying "active", which nobody could tell was clickable. */}
        <button
          onClick={() => updateProfile(profile.id, { active: !profile.active })}
          title={
            profile.active
              ? "Archive this member — they keep all their logged hours but drop off the team list, pickers and plan"
              : profile.endDate
                ? "Bring this member back — this also clears their end date, which would otherwise re-archive them"
                : "Bring this member back onto the team list and pickers"
          }
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${
            profile.active
              ? "border-border bg-surface text-muted hover:border-danger hover:text-danger"
              : "border-border bg-surface text-brand hover:border-brand"
          }`}
        >
          {profile.active ? <Archive size={14} /> : <ArchiveRestore size={14} />}
          {profile.active ? "Archive" : "Restore"}
        </button>
      </div>

      {/* Back link, archived banner and the header stay OUTSIDE the tabs: they are
          identity and page-level state, and the Archive control must be reachable
          from either tab. */}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview" as const, label: "Overview" },
          { value: "hr" as const, label: "HR details" },
        ]}
        ariaLabel="Member sections"
      />

      {/* Tiles fill the left half, the chart the right. content-start keeps the
          tile column its natural height instead of stretching four tall empty
          boxes to match the chart. Below lg it stacks, tiles staying 2×2. */}
      <div className={`grid items-stretch gap-4 lg:grid-cols-2 ${tab === "overview" ? "" : "hidden"}`}>
        {/* Tiles, then the open-task list directly under them — it fills the
            height the chart sets beside it instead of leaving the column short. */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Hours this month" value={formatHoursShort(monthMinutes)} />
            <Stat
              label="Billable share (month)"
              value={monthMinutes > 0 ? `${Math.round((monthBillable / monthMinutes) * 100)}%` : "–"}
            />
            <Stat label="Total logged" value={formatHoursShort(totalMinutes)} />
            <Stat label="Clients worked on" value={String(clientCount)} />
          </div>
          <OpenTasksPane profileId={profile.id} />
        </div>

        <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
            Hours per month
          </h2>
          {/* MultiLineChart, not LineChart: with 12 buckets LineChart labels no
              points at all and degrades to an unlabelled squiggle, while this one
              brings gridlines, y-axis hours, thinned x-labels and a tooltip with
              the change vs the previous month. */}
          <MultiLineChart
            labels={perMonth.map((b) => b.label)}
            series={[{ label: "Hours", color: "#0b43ed", values: perMonth.map((b) => b.minutes) }]}
            totalLabel="last 12 months of activity"
            projection={projection ?? undefined}
          />
        </div>
      </div>

      <div className={tab === "overview" ? "" : "hidden"}>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-faint">
            Most active clients
          </h2>
          {topClients.map(({ client, minutes }) => (
            <HBar
              key={client!.id}
              label={<ClientChip client={client!} size="sm" />}
              right={formatHoursShort(minutes)}
              minutes={minutes}
              maxMinutes={maxClient}
            />
          ))}
          {topClients.length === 0 && (
            <p className="text-sm text-faint">No logged hours yet.</p>
          )}
        </div>
      </div>

      {/* Mounted only once the tab has been opened, then kept mounted and hidden.
          Two reasons, both load-bearing: HrFields uses uncontrolled defaultValue
          inputs saved on blur, so unmounting would silently discard typed text;
          and until an admin asks for this tab, member_hr / member_notes are never
          queried at all — opening someone's page to check their hours no longer
          pulls national IDs and home addresses into the browser. */}
      {hrMounted && (
      <div className={`flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 ${tab === "hr" ? "" : "hidden"}`}>
        <h2 className="text-xs font-medium uppercase tracking-wide text-faint">HR details</h2>
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Start date
            <input
              type="date"
              value={profile.startDate ?? ""}
              onChange={(e) => updateProfile(profile.id, { startDate: e.target.value || null })}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            End date
            <input
              type="date"
              value={profile.endDate ?? ""}
              min={profile.startDate ?? undefined}
              onChange={(e) => updateProfile(profile.id, { endDate: e.target.value || null })}
              title="Last day in the studio. Setting it archives them; clearing it does not bring them back — use Restore for that."
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            />
            {profile.endDate && (
              <span className="text-[11px] font-normal text-faint">archived by this date</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Capacity (h/week)
            <input
              type="number"
              min={0}
              max={80}
              step={0.5}
              value={profile.capacityHoursWeek ?? ""}
              onChange={(e) =>
                updateProfile(profile.id, {
                  capacityHoursWeek: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="40"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>
        <HrFields profileId={profile.id} />
        <NotesField profileId={profile.id} />
        {profile.hasAccount === false ? (
          // A person kept only for historical attribution (migration 0018). There is
          // no auth.users row, so every account action would fail — and offering
          // "Send password link" for someone who left in 2019 is just misleading.
          <p className="text-xs text-muted">
            Kept for historical attribution — no account, so this person can&apos;t sign in.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={sendReset}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand"
            >
              Send password link
            </button>
            {resetStatus && <span className="text-xs text-muted">{resetStatus}</span>}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
