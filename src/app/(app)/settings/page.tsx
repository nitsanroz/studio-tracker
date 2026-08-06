"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { ensureStudioIntakeLink, studioIntakeLinkUrl } from "@/lib/intake-links";
import { Tabs, TagBadge } from "@/components/ui";
import { ClientAvatar } from "@/components/client-avatar";
import { ClientMarkModal } from "@/components/client-mark-picker";
import { MemberPictures } from "@/components/picture-editor";
import { HrDetailsForm } from "@/components/hr-details-form";
import { OccasionsSettings } from "@/components/occasions-settings";
import type { Tag, TaskType } from "@/lib/types";

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
  // which client's mark is being edited — a 25-glyph grid plus an upload has no
  // place inline in a list row, so it opens over it
  const [markFor, setMarkFor] = useState<string | null>(null);
  const marking = markFor ? clients.find((c) => c.id === markFor) : null;

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
                {/* the mark itself is the button — clicking what you want to
                    change beats hunting for a pencil three columns away */}
                <button
                  onClick={() => setMarkFor(c.id)}
                  title={`Change ${c.name}'s mark — colour, glyph or image`}
                  className="rounded-lg outline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-brand"
                >
                  <ClientAvatar client={c} size={26} />
                </button>
                {/* No swatch beside it: the mark IS the colour, and two
                    coloured squares in a row read as two different things.
                    The colour wheel lives in the mark popup. */}
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
              <ClientAvatar client={c} size={26} />
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
      {marking && <ClientMarkModal client={marking} onClose={() => setMarkFor(null)} />}
      {isAdmin && (
        <p className="mt-2 text-xs text-faint">
          Click a mark to change its colour, pick a glyph, or upload and remove the client&apos;s
          logo. The color marks the client&apos;s chips across the app. Archived clients disappear from the
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
        title="Status colour"
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
          if (confirm(`Delete status "${tag.name}"? Tasks using it will lose it.`))
            deleteTag(tag.id);
        }}
        className="shrink-0 rounded p-1.5 text-muted hover:bg-red-50 hover:text-danger"
        title="Delete status"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/**
 * Kinds of work (migration 0024) — the colours the client Timeline paints with.
 *
 * Deliberately its own section beside Task statuses rather than merged into it: a
 * tag says where a task is in the process ("Client approval"), a type says what
 * the work IS ("QA"). Sharing one list would force a task to pick one or the
 * other.
 */
function TaskTypeRow({ type }: { type: TaskType }) {
  const { tasks, updateTaskType, deleteTaskType } = useData();
  const [name, setName] = useState(type.name);
  const inUse = tasks.filter((t) => t.typeId === type.id).length;

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <input
        type="color"
        value={type.color}
        onChange={(e) => updateTaskType(type.id, { color: e.target.value })}
        className="size-6 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
        title="Type colour — used for this type's bars on the client Timeline"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (!trimmed || trimmed === type.name) {
            setName(type.name);
            return;
          }
          updateTaskType(type.id, { name: trimmed });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(type.name);
        }}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-border focus:border-brand focus:outline-none"
      />
      <span className="shrink-0 text-xs tabular-nums text-faint">
        {inUse === 0 ? "unused" : `${inUse} task${inUse === 1 ? "" : "s"}`}
      </span>
      <button
        onClick={() => {
          // The FK is ON DELETE SET NULL, so nothing is lost but the label —
          // say how many tasks that affects rather than asking blind.
          const warn = inUse
            ? `Delete type "${type.name}"? ${inUse} task${inUse === 1 ? "" : "s"} will lose it.`
            : `Delete type "${type.name}"?`;
          if (confirm(warn)) deleteTaskType(type.id);
        }}
        className="shrink-0 rounded p-1.5 text-muted hover:bg-red-50 hover:text-danger"
        title="Delete type"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function TaskTypesSection() {
  const { taskTypes, addTaskType } = useData();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#0b43ed");

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-heading">Task types</h2>
      <p className="mb-2 text-xs text-muted">
        The kind of work a task is. Each type&apos;s colour is what its bars are drawn in on a
        client&apos;s Timeline.
      </p>
      <div className="flex flex-col divide-y divide-border">
        {taskTypes.map((t) => (
          <TaskTypeRow key={t.id} type={t} />
        ))}
        {taskTypes.length === 0 && <p className="py-2 text-sm text-faint">No types yet.</p>}
      </div>
      <form
        className="mt-3 flex items-center gap-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = newName.trim();
          if (!trimmed) return;
          addTaskType(trimmed, newColor);
          setNewName("");
        }}
      >
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="size-6 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
          title="New type colour"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New type — e.g. Wireframe…"
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
          Add
        </button>
      </form>
    </section>
  );
}

function TagsSection({ isAdmin }: { isAdmin: boolean }) {
  const { tags, addTag } = useData();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#0b43ed");

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-heading">Task statuses</h2>
      <p className="mb-2 text-xs text-muted">
        Where a task is in the process — in design, waiting on the client, approved. What KIND of
        work it is lives in Task types above.
      </p>
      <div className="flex flex-col divide-y divide-border">
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} isAdmin={isAdmin} />
        ))}
        {tags.length === 0 && <p className="py-2 text-sm text-faint">No statuses yet.</p>}
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
            title="New status colour"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New status — e.g. In review…"
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
    // matches the other own-account cards, now that it stands alone on its tab
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-1 font-heading">Change password</h2>
      <p className="mb-4 text-xs text-muted">
        At least 6 characters. You stay signed in on this device.
      </p>
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
    </section>
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

type SettingsTab = "pictures" | "details" | "password" | "clients" | "studio";
const TAB_KEY = "settings.tab";

/**
 * The own-account surface, split for EVERYONE rather than only for members: it is
 * the same three blocks whoever is looking, and one long scroll past two picture
 * uploaders and fourteen HR fields to reach the password field is the same scroll
 * for an admin. Members used to get no strip at all, because their whole page was
 * one tab — which is also why it was the longest page in the app.
 */
const ACCOUNT_TABS = [
  { value: "pictures" as const, label: "My pictures" },
  { value: "details" as const, label: "My details" },
  { value: "password" as const, label: "Password" },
];
const ADMIN_TABS = [
  { value: "clients" as const, label: "Clients" },
  { value: "studio" as const, label: "Studio setup" },
];
/** v1.1.x stored a single "account" tab, which has since split into three */
const LEGACY_TABS: Record<string, SettingsTab> = { account: "pictures" };

export default function SettingsPage() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<SettingsTab>("pictures");

  const tabs = isAdmin ? [...ACCOUNT_TABS, ...ADMIN_TABS] : ACCOUNT_TABS;
  /**
   * Lazily mounted, then never unmounted — `HrDetailsForm` is controlled state
   * behind ONE explicit Save, so unmounting it on a tab switch would silently
   * discard fourteen fields of typed-but-unsaved text. Keeping it mounted also
   * means /api/me/hr is read once per visit, and not at all until you open the
   * tab.
   */
  const [detailsMounted, setDetailsMounted] = useState(false);
  useEffect(() => {
    if (tab === "details") setDetailsMounted(true);
  }, [tab]);

  useEffect(() => {
    const raw = localStorage.getItem(TAB_KEY);
    const v = raw ? (LEGACY_TABS[raw] ?? raw) : null;
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

      <Tabs value={tab} onChange={pickTab} items={tabs} ariaLabel="Settings sections" />

      {/* The hand-split two-column masonry is gone. It was why ChangePassword had
          to be rendered TWICE (once per column, to balance an admin's page), and
          it meant source order didn't match visual order. */}
      {tab === "pictures" && (
        <div className="flex max-w-[860px] flex-col gap-4">
          <MyProfile />
        </div>
      )}

      {detailsMounted && (
        <div
          className={`flex max-w-[860px] flex-col gap-4 ${tab === "details" ? "" : "hidden"}`}
        >
          <MyDetails />
        </div>
      )}

      {tab === "password" && (
        <div className="flex max-w-[860px] flex-col gap-4">
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
          <TaskTypesSection />
          <TagsSection isAdmin={isAdmin} />
          <IntakeSettings />
          <OccasionsSettings />
        </div>
      )}
    </div>
  );
}
