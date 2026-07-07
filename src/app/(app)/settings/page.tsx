"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar, ClientChip } from "@/components/ui";
import type { Profile, Role } from "@/lib/types";

function TeamRow({ member, isAdmin }: { member: Profile; isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState(member);
  const [status, setStatus] = useState<string | null>(null);

  async function patch(fields: Partial<Pick<Profile, "role" | "active">>) {
    const prev = profile;
    setProfile((p) => ({ ...p, ...fields }));
    const { error } = await supabase
      .from("profiles")
      .update({ role: fields.role ?? profile.role, active: fields.active ?? profile.active })
      .eq("id", profile.id);
    if (error) {
      setProfile(prev);
      setStatus(error.message);
    }
  }

  async function sendReset() {
    setStatus("…");
    // Profiles don't expose emails client-side; ask the server? Emails follow
    // first@studionmore.com — admins type it in the prompt for now.
    const email = window.prompt(`Send a password reset/set link.\nEmail for ${profile.name}:`);
    if (!email) {
      setStatus(null);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset/update`,
    });
    setStatus(error ? error.message : "Reset link sent ✓");
  }

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <Avatar profile={profile} size={28} />
      <span className={`min-w-0 flex-1 truncate font-medium ${profile.active ? "" : "text-faint line-through"}`}>
        {profile.name}
      </span>
      {status && <span className="text-xs text-muted">{status}</span>}
      {isAdmin ? (
        <>
          <button
            onClick={sendReset}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand"
          >
            Send password link
          </button>
          <select
            value={profile.role}
            onChange={(e) => patch({ role: e.target.value as Role })}
            className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
          >
            <option value="designer">designer</option>
            <option value="admin">admin</option>
          </select>
          <button
            onClick={() => patch({ active: !profile.active })}
            className={`w-24 rounded-full px-2 py-1 text-xs font-medium ${
              profile.active
                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {profile.active ? "active" : "deactivated"}
          </button>
        </>
      ) : (
        <>
          <span className="text-xs capitalize text-muted">{profile.role}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              profile.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"
            }`}
          >
            {profile.active ? "active" : "deactivated"}
          </span>
        </>
      )}
    </div>
  );
}

function AddMember() {
  const [form, setForm] = useState({ email: "", name: "", role: "designer" });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setStatus(body.error ?? "Failed");
      return;
    }
    setStatus(
      `${form.name} added ✓ — they set their password via "Forgot password" on the login page (reload to see them).`,
    );
    setForm({ email: "", name: "", role: "designer" });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Name
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-40 rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Email
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className="w-56 rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Role
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
        >
          <option value="designer">designer</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button
        disabled={busy}
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {busy ? "Adding…" : "+ Add member"}
      </button>
      {status && <p className="w-full text-xs text-muted">{status}</p>}
    </form>
  );
}

function MyProfile() {
  const { profiles, currentUserId, patchProfileLocal } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!me) return null;

  async function upload(file: File) {
    setBusy(true);
    setStatus(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/avatar", { method: "POST", body });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setStatus(json.error ?? "Upload failed");
      return;
    }
    patchProfileLocal(me!.id, { avatarUrl: json.avatarUrl });
    setStatus("Avatar updated ✓");
  }

  async function remove() {
    setBusy(true);
    const res = await fetch("/api/avatar", { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      patchProfileLocal(me!.id, { avatarUrl: null });
      setStatus("Back to initials ✓");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-heading">My profile</h2>
      <div className="flex items-center gap-4">
        <Avatar profile={me} size={56} />
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-medium">{me.name}</div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
              {busy ? "Uploading…" : "Upload avatar"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            {me.avatarUrl && (
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-danger hover:text-danger"
              >
                Remove
              </button>
            )}
          </div>
          {status && <div className="text-xs text-muted">{status}</div>}
        </div>
      </div>
    </section>
  );
}

function ClientsSection({ isAdmin }: { isAdmin: boolean }) {
  const { clients, updateClient } = useData();
  const [showArchived, setShowArchived] = useState(false);

  const list = clients
    .filter((c) => showArchived || !c.archived)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-heading">Clients</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {list.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-1.5 text-sm">
            <span className={`min-w-0 flex-1 ${c.archived ? "opacity-40" : ""}`}>
              <ClientChip client={c} />
            </span>
            {c.archived && <span className="text-xs text-faint">archived</span>}
            {isAdmin && (
              <button
                onClick={() => updateClient(c.id, { archived: !c.archived })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  c.archived
                    ? "border-border text-muted hover:border-success hover:text-success"
                    : "border-border text-muted hover:border-warning hover:text-warning"
                }`}
              >
                {c.archived ? "Restore" : "Archive"}
              </button>
            )}
          </div>
        ))}
      </div>
      {isAdmin && (
        <p className="mt-2 text-xs text-faint">
          Archived clients disappear from the Clients page and pickers; their history stays in
          reports.
        </p>
      )}
    </section>
  );
}

function IntakeSettings() {
  const supabase = useMemo(() => createClient(), []);
  const [emails, setEmails] = useState<string>("");
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: setting }, { data: links }] = await Promise.all([
        supabase.from("app_settings").select("value").eq("key", "intake_notify_emails").maybeSingle(),
        supabase.from("intake_links").select("token").is("client_id", null).eq("active", true).limit(1),
      ]);
      if (Array.isArray(setting?.value)) setEmails((setting.value as string[]).join(", "));
      if (links?.[0]) setLink(`${window.location.origin}/intake/${links[0].token}`);
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [supabase]);

  async function saveEmails() {
    const list = emails
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "intake_notify_emails", value: list });
    setStatus(error ? error.message : `Saved — ${list.length} recipient${list.length === 1 ? "" : "s"} ✓`);
  }

  async function createLink() {
    const { data, error } = await supabase
      .from("intake_links")
      .insert({ client_id: null })
      .select("token")
      .single();
    if (error) {
      setStatus(error.message.includes("column") ? "Run migration 0003 first" : error.message);
      return;
    }
    setLink(`${window.location.origin}/intake/${data.token}`);
  }

  if (!loaded) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-heading">Client intake form</h2>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">
            Form link — share with clients
          </div>
          {link ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 text-xs">
                {link}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  setStatus("Link copied ✓");
                }}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-brand"
              >
                Copy
              </button>
              <a
                href={link}
                target="_blank"
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-brand"
              >
                Open
              </a>
            </div>
          ) : (
            <button
              onClick={createLink}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Create form link
            </button>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">
            Notify these emails on every submission
          </div>
          <div className="flex gap-2">
            <input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="nitsan@studionmore.com, office@studionmore.com"
              className="flex-1 rounded-md border border-border-strong px-2 py-1.5 text-sm"
            />
            <button
              onClick={saveEmails}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black"
            >
              Save
            </button>
          </div>
        </div>
        {status && <p className="text-xs text-muted">{status}</p>}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { profiles, tags, currentUserId } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = me?.role === "admin";
  const [showDeactivated, setShowDeactivated] = useState(false);

  const team = profiles
    .filter((p) => showDeactivated || p.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl">Settings</h1>

      <MyProfile />

      {isAdmin && <IntakeSettings />}

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading">Team</h2>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showDeactivated}
              onChange={(e) => setShowDeactivated(e.target.checked)}
            />
            Show deactivated
          </label>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {team.map((p) => (
            <TeamRow key={p.id} member={p} isAdmin={isAdmin} />
          ))}
        </div>
        {isAdmin && <AddMember />}
      </section>

      <ClientsSection isAdmin={isAdmin} />

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-heading">Task tags</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-background px-3 py-1 text-sm">
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
