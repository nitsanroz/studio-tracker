"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar, TagBadge } from "@/components/ui";
import type { Tag } from "@/lib/types";

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
            {isAdmin ? (
              <span className="flex shrink-0 items-center gap-1">
                <input
                  type="color"
                  value={c.color}
                  onChange={(e) => updateClient(c.id, { color: e.target.value })}
                  className="size-6 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
                  title={`Color for ${c.name}`}
                />
                <input
                  key={c.color}
                  defaultValue={c.color}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(v) && v !== c.color) updateClient(c.id, { color: v });
                    else e.target.value = c.color;
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-[4.6rem] rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-muted outline-none hover:border-border focus:border-brand"
                  title="Hex — paste or type, Enter to apply"
                />
              </span>
            ) : (
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
            )}
            <span className={`min-w-0 flex-1 truncate font-medium ${c.archived ? "opacity-40" : ""}`}>
              {c.name}
            </span>
            {c.archived && <span className="text-xs text-faint">archived</span>}
            {isAdmin && (
              <label
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 text-xs ${c.billable ? "text-muted" : "text-warning"}`}
                title="Internal clients (unchecked) are non-billable: new tasks are created non-billable"
              >
                <input
                  type="checkbox"
                  checked={c.billable}
                  onChange={(e) => updateClient(c.id, { billable: e.target.checked })}
                />
                {c.billable ? "Billable" : "Internal"}
              </label>
            )}
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
          The color marks the client&apos;s chips across the app. Archived clients disappear from the
          Clients page and pickers; their history stays in reports. Switching a client to
          &quot;Internal&quot; marks all its tasks (existing and future) non-billable; switching back
          only affects new tasks.
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

function TagRow({ tag, isAdmin }: { tag: Tag; isAdmin: boolean }) {
  const { updateTag, deleteTag } = useData();
  const [name, setName] = useState(tag.name);

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tag.name) {
      setName(tag.name);
      return;
    }
    updateTag(tag.id, { name: trimmed });
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-3 py-1.5">
        <TagBadge tag={tag.name} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <input
        type="color"
        value={tag.color}
        onChange={(e) => updateTag(tag.id, { color: e.target.value })}
        className="size-6 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
        title="Tag color"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(tag.name);
        }}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-border focus:border-brand focus:outline-none"
      />
      <TagBadge tag={tag.name} />
      <button
        onClick={() => {
          if (confirm(`Delete tag "${tag.name}"? Tasks using it will lose the tag.`))
            deleteTag(tag.id);
        }}
        className="shrink-0 rounded p-1.5 text-muted hover:bg-red-50 hover:text-danger"
        title="Delete tag"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function TagsSection({ isAdmin }: { isAdmin: boolean }) {
  const { tags, addTag } = useData();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#0b43ed");

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 font-heading">Task tags</h2>
      <div className="flex flex-col divide-y divide-border">
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} isAdmin={isAdmin} />
        ))}
        {tags.length === 0 && <p className="py-2 text-sm text-faint">No tags yet.</p>}
      </div>
      {isAdmin && (
        <form
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = newName.trim();
            if (!trimmed) return;
            addTag(trimmed, newColor);
            setNewName("");
          }}
        >
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="size-6 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
            title="New tag color"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag name…"
            className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            Add
          </button>
        </form>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { profiles, currentUserId } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = me?.role === "admin";

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <h1 className="text-2xl">Settings</h1>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <MyProfile />

          {isAdmin && (
            <Link
              href="/team"
              className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium hover:border-brand"
            >
              Users are managed on the Team page
              <ArrowRight size={15} className="ml-auto text-muted" />
            </Link>
          )}

          {isAdmin && <IntakeSettings />}

          <TagsSection isAdmin={isAdmin} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ClientsSection isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
