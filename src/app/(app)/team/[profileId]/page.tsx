"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { presetRange } from "@/lib/date-ranges";
import { formatHoursShort, MONTH_NAMES_SHORT } from "@/lib/format";
import { useMemberEmails } from "@/lib/use-member-emails";
import { ClientChip } from "@/components/ui";
import { PictureEditBadge } from "@/components/picture-editor";
import { HBar, MiniColumns } from "@/components/charts";
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
  const { profiles, tasks, clients, entrySums, currentUserId, updateProfile } = useData();
  const supabase = useMemo(() => createClient(), []);
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const profile = profiles.find((p) => p.id === profileId);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const email = useMemberEmails(isAdmin)[profileId];

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const mine = useMemo(
    () => entrySums.filter((e) => e.userId === profileId),
    [entrySums, profileId],
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

  // ── hours per month, last 12 months ──
  const perMonth = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; minutes: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        label:
          d.getMonth() === 0
            ? `${MONTH_NAMES_SHORT[0]} ${String(d.getFullYear()).slice(2)}`
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
            <span className="font-medium text-foreground">{profile.name}</span> is archived — hidden
            from the team list, assignee pickers and the weekly plan. All logged hours are kept.
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hours this month" value={formatHoursShort(monthMinutes)} />
        <Stat
          label="Billable share (month)"
          value={monthMinutes > 0 ? `${Math.round((monthBillable / monthMinutes) * 100)}%` : "–"}
        />
        <Stat label="Total logged" value={formatHoursShort(totalMinutes)} />
        <Stat label="Clients worked on" value={String(clientCount)} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
            Hours per month
          </h2>
          <MiniColumns points={perMonth.map((b) => ({ label: b.label, minutes: b.minutes }))} />
        </div>

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

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
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
        <div className="flex items-center gap-2">
          <button
            onClick={sendReset}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand"
          >
            Send password link
          </button>
          {resetStatus && <span className="text-xs text-muted">{resetStatus}</span>}
        </div>
      </div>
    </div>
  );
}
