"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { ensureStudioIntakeLink, studioIntakeLinkUrl } from "@/lib/intake-links";
import { Tabs, TagBadge } from "@/components/ui";
import { MemberPictures } from "@/components/picture-editor";
import { HrDetailsForm } from "@/components/hr-details-form";
import { OccasionsSettings } from "@/components/occasions-settings";
import type { Tag } from "@/lib/types";

function MyProfile() {
  const { profiles, currentUserId } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  if (!me) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-1 font-heading">My pictures</h2>
      <p className="mb-4 text-xs text-muted">
        Your avatar and your studio portrait. Admins can also set these for you.
      </p>
      <MemberPictures profile={me} />
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
      const [{ data: setting }, url] = await Promise.all([
        supabase.from("app_settings").select("value").eq("key", "intake_notify_emails").maybeSingle(),
        // read-only, so merely opening Settings never mints a link
        studioIntakeLinkUrl(),
      ]);
      if (Array.isArray(setting?.value)) setEmails((setting.value as string[]).join(", "));
      if (url) setLink(url);
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
    const url = await ensureStudioIntakeLink();
    if (!url) {
      setStatus("Couldn't create a form link — check that migration 0003 is applied.");
      return;
    }
    setLink(url);
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

function ChangePassword() {
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const canSave = password.length >= 6 && password === confirm && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
    } else {
      setMsg({ ok: true, text: "Password updated." });
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-heading">Change password</h2>
      <div className="flex max-w-sm flex-col gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 6 characters)"
          autoComplete="new-password"
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Repeat new password"
          autoComplete="new-password"
          className={`rounded-md border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand ${
            confirm && confirm !== password ? "border-danger" : "border-border"
          }`}
        />
        <div className="flex items-center gap-3">
          <button
            disabled={!canSave}
            onClick={save}
            className="w-fit rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
          {msg && (
            <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MyDetails() {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-1 font-heading">My details</h2>
      <p className="mb-4 text-xs text-muted">
        For HR and payroll paperwork. Visible only to you and the studio admins.
      </p>
      <HrDetailsForm />
    </section>
  );
}

type SettingsTab = "account" | "clients" | "studio";
const TAB_KEY = "settings.tab";

export default function SettingsPage() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<SettingsTab>("account");

  // A member's whole surface is "My account", so they get no strip at all — a
  // one-tab control is a control that does nothing.
  const tabs = isAdmin
    ? ([
        { value: "account" as const, label: "My account" },
        { value: "clients" as const, label: "Clients" },
        { value: "studio" as const, label: "Studio setup" },
      ])
    : ([{ value: "account" as const, label: "My account" }]);

  useEffect(() => {
    const v = localStorage.getItem(TAB_KEY);
    // Validated against the tabs actually visible: a stored "clients" becomes
    // invalid under ?viewAs or after a role change, and an unvalidated read would
    // render a blank page.
    if (v && tabs.some((t) => t.value === v)) setTab(v as SettingsTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);
  function pickTab(v: SettingsTab) {
    setTab(v);
    try {
      localStorage.setItem(TAB_KEY, v);
    } catch {}
  }

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <h1 className="font-serif-accent text-3xl">Settings</h1>

      {tabs.length > 1 && (
        <Tabs value={tab} onChange={pickTab} items={tabs} ariaLabel="Settings sections" />
      )}

      {/* The hand-split two-column masonry is gone. It was why ChangePassword had
          to be rendered TWICE (once per column, to balance an admin's page), and
          it meant source order didn't match visual order. */}
      {tab === "account" && (
        <div className="flex max-w-[860px] flex-col gap-4">
          <MyProfile />
          <MyDetails />
          <ChangePassword />
        </div>
      )}

      {/* Every admin block keeps its own gate, so a bug in tab visibility can
          never become a data-exposure bug. */}
      {tab === "clients" && isAdmin && (
        <div className="flex max-w-[860px] flex-col gap-4">
          <Link
            href="/team"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium hover:border-brand"
          >
            Users are managed on the Team page
            <ArrowRight size={15} className="ml-auto text-muted" />
          </Link>
          <ClientsSection isAdmin={isAdmin} />
        </div>
      )}

      {tab === "studio" && isAdmin && (
        // three cards, so plain source-order auto-placement rather than a
        // hand-split masonry
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <TagsSection isAdmin={isAdmin} />
          <IntakeSettings />
          <OccasionsSettings />
        </div>
      )}
    </div>
  );
}
