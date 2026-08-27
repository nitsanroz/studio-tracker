"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  renderSeenEmail,
  SEEN_EMAIL_DEFAULT,
  SEEN_UPDATE_EMAIL_DEFAULT,
  SEEN_EMAIL_PLACEHOLDERS,
  type SeenEmailTemplate,
} from "@/lib/brief";
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

/**
 * The wording of the one email that leaves the building.
 *
 * Everything else the tracker sends goes to the studio's own inboxes, where a
 * clumsy sentence costs nothing. This one lands in a client's inbox under the
 * studio's name, so the studio edits it here rather than asking for a deploy.
 *
 * Stored in `app_settings` (0003) — key/jsonb, admin-write by RLS, so it needs
 * no schema of its own. `/api/intake/seen` reads it and falls back to
 * SEEN_EMAIL_DEFAULT if it is missing or malformed.
 */
function ClientEmailSettings({
  settingKey = "intake_seen_email",
  fallback = SEEN_EMAIL_DEFAULT,
  title = "Email to the client",
  blurb,
}: {
  /** ⚠️ Two receipts share this editor: the first brief, and a later change to
   *  one. Parameterised rather than copied, so the placeholder list, the escaping
   *  and the save behaviour cannot drift between them. */
  settingKey?: string;
  fallback?: SeenEmailTemplate;
  title?: string;
  blurb?: React.ReactNode;
} = {}) {
  const supabase = useMemo(() => createClient(), []);
  const [tpl, setTpl] = useState<SeenEmailTemplate>(fallback);
  const [saved, setSaved] = useState<SeenEmailTemplate>(fallback);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", settingKey)
      .maybeSingle()
      .then(({ data }) => {
        const v = data?.value as Partial<SeenEmailTemplate> | null;
        if (v && typeof v === "object") {
          const next = {
            subject: typeof v.subject === "string" ? v.subject : fallback.subject,
            body: typeof v.body === "string" ? v.body : fallback.body,
          };
          setTpl(next);
          setSaved(next);
        }
        setLoaded(true);
      });
    // ⚠️ `settingKey` and `fallback` belong here now that the editor serves two
    // templates — without them a change of key would keep showing the other
    // one's saved text. Both are module constants at every call site, so the
    // effect still runs exactly once per instance.
  }, [supabase, settingKey, fallback]);

  const dirty = tpl.subject !== saved.subject || tpl.body !== saved.body;

  // What a client would actually receive, with the placeholders filled in from
  // SEEN_EMAIL_PLACEHOLDERS' samples — a preview showing "{firstName}" would be
  // no preview at all.
  const preview = useMemo(() => {
    const s = Object.fromEntries(SEEN_EMAIL_PLACEHOLDERS.map((p) => [p.token, p.sample]));
    return renderSeenEmail(tpl, {
      submitterName: s["{name}"],
      taskName: s["{task}"],
      company: s["{company}"],
    });
  }, [tpl]);

  async function save() {
    const value = { subject: tpl.subject.trim(), body: tpl.body.trim() };
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: settingKey, value });
    if (error) {
      setStatus(error.message);
      return;
    }
    setSaved(value);
    setTpl(value);
    setStatus("Saved ✓");
  }

  if (!loaded) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-heading">{title}</h2>
      <p className="mb-3 text-xs text-muted">
        {blurb ?? (
          <>
            Sent when you press <span className="font-medium">Tell client we&apos;ve seen it</span>{" "}
            on a submission in the Intake Queue. Nothing is sent automatically.
          </>
        )}
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Subject</div>
          <input
            value={tpl.subject}
            onChange={(e) => setTpl((t) => ({ ...t, subject: e.target.value }))}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Message</div>
          <textarea
            value={tpl.body}
            onChange={(e) => setTpl((t) => ({ ...t, body: e.target.value }))}
            rows={9}
            className="w-full resize-y rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm leading-relaxed"
          />
          <p className="mt-1 text-xs text-faint">
            Leave a blank line between paragraphs. These get filled in:{" "}
            {SEEN_EMAIL_PLACEHOLDERS.map((p, i) => (
              <span key={p.token}>
                {i > 0 && ", "}
                <code
                  className="cursor-pointer rounded bg-background px-1 hover:text-brand"
                  title={`${p.describes} — click to add`}
                  onClick={() => setTpl((t) => ({ ...t, body: `${t.body}${p.token}` }))}
                >
                  {p.token}
                </code>
              </span>
            ))}
          </p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">
            Preview — what the client sees
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="mb-2 border-b border-border pb-2 text-sm font-medium">
              {preview.subject}
            </p>
            {/* The renderer's own output, so the preview can't drift from the
                mail. It is built here from escaped text — never from anything
                a client typed. */}
            <div
              className="text-sm text-muted [&_p]:mb-2 last:[&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => setTpl(SEEN_EMAIL_DEFAULT)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted hover:border-brand hover:text-brand"
          >
            Reset to default
          </button>
          {status && <span className="text-xs text-muted">{status}</span>}
        </div>
      </div>
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

type SettingsTab = "pictures" | "details" | "password" | "clients" | "studio" | "intake";
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
  // Its own tab rather than two more cards under Studio setup: everything here
  // is about the ONE surface clients see and the mail that goes back to them,
  // which is a different job from the studio's task types and statuses.
  { value: "intake" as const, label: "Intake form" },
];
/** v1.1.x stored a single "account" tab, which has since split into three */
const LEGACY_TABS: Record<string, SettingsTab> = { account: "pictures" };

/**
 * What the Content Security Policy has refused, for admins.
 *
 * ⚠️ WHY IT EXISTS: v1.39.0's CSP caught a live dependency nobody knew about — 17
 * avatars still served from Everhour's retired CDN — and only because somebody
 * happened to have the browser console open. v1.41.0 added the report sink; without
 * somewhere to READ it, the next unknown third party still fails silently and
 * reaches us as "the app looks wrong".
 *
 * ⚠️ AN EMPTY LIST IS GOOD NEWS AND MUST SAY SO. A blank card reads as broken, and
 * "nothing has been blocked" is the state we expect almost always.
 *
 * ⚠️ `dropped` IS SHOWN WHENEVER IT IS NON-ZERO. The store caps distinct
 * signatures, and a full cap silently hiding new ones would present as "no new
 * violations" — the one thing this must never claim falsely.
 */
type CspStore = {
  items: {
    sig: string;
    directive: string;
    blocked: string;
    documentUri: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }[];
  updatedAt: string | null;
  dropped: number;
};

function CspReportsSection() {
  const [store, setStore] = useState<CspStore | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  /**
   * ⚠️ The fetch is factored out so the EFFECT can await it without setting state
   * synchronously — `useEffect(load, [load])` tripped
   * `react-hooks/set-state-in-effect`, because `load` flips to "loading" on entry.
   * The Refresh button still wants that flip (it is an event handler, where a
   * synchronous setState is exactly right), hence two callers of one reader.
   *
   * ⚠️ ONE alive flag, READ INSIDE the fetcher rather than passed in. The Refresh
   * button used to hand `read` its own `() => true`, opting itself out of the very
   * guard the effect had added — click Refresh, switch tab, and the late response
   * still set state on an unmounted card. Taking no parameter makes that
   * unrepresentable instead of merely discouraged. A ref rather than a local,
   * because the button's handler outlives any one effect run.
   */
  const alive = useRef(true);
  const read = useCallback(
    () =>
      fetch("/api/csp-report", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          if (!alive.current) return;
          setStore(j as CspStore);
          setState("ok");
        })
        .catch(() => {
          if (alive.current) setState("error");
        }),
    [],
  );
  const load = useCallback(() => {
    setState("loading");
    void read();
  }, [read]);
  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  const items = store?.items ?? [];
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-1 font-heading">Blocked by the security policy</h2>
      <p className="mb-3 text-xs text-muted">
        Anything the browser refused to load — a script, image or connection the policy does not
        allow. This is how a retired third-party CDN or a new embed announces itself instead of just
        looking broken.
      </p>

      {state === "loading" && <p className="text-sm text-muted">Reading…</p>}
      {state === "error" && (
        <p className="text-sm text-danger">
          Could not read the reports. The endpoint is admin-only — if this keeps happening, check the
          browser console.
        </p>
      )}

      {state === "ok" && items.length === 0 && (
        <p className="text-sm text-success">Nothing has been blocked. Everything the app loads is allowed.</p>
      )}

      {state === "ok" && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="pb-1 pr-3 font-medium">Blocked</th>
                <th className="pb-1 pr-3 font-medium">Rule</th>
                <th className="pb-1 pr-3 font-medium tabular-nums">Times seen</th>
                <th className="pb-1 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.sig} className="border-t border-border">
                  {/* The origin, not the full URL — one CDN is one problem, and a
                      path is more data than we have any reason to keep. */}
                  <td className="py-1.5 pr-3 font-medium" title={i.documentUri}>
                    {i.blocked}
                  </td>
                  <td className="py-1.5 pr-3 text-muted">{i.directive}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted">{i.count}</td>
                  {/* Both ends: "first seen" is what distinguishes a one-off
                      from something that has been happening for a fortnight, and
                      it is the honest substitute for a precise count. */}
                  <td className="py-1.5 text-muted" title={`first seen ${new Date(i.firstSeen).toLocaleString()}`}>
                    {new Date(i.lastSeen).toLocaleDateString()}
                    {i.firstSeen.slice(0, 10) !== i.lastSeen.slice(0, 10) && (
                      <span className="text-faint">
                        {" "}
                        (since {new Date(i.firstSeen).toLocaleDateString()})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ⚠️⚠️ THE COUNT IS A FLOOR AND MUST SAY SO. Repeats of the same violation
          inside 10 minutes are collapsed into one write (`mergeReports` — the
          endpoint is unauthenticated and egress is this project's tightest
          constraint), so a violation firing on every page load can show "1". An
          admin sizing a problem by an unqualified number would read a count of
          throttle windows as a count of violations. ⚠️ It cannot be a per-row
          marker: once collapsed, an entry is indistinguishable from a single
          sighting. */}
      {state === "ok" && items.length > 0 && (
        <p className="mt-2 text-[11px] text-faint">
          Repeats within 10 minutes are counted once, so &ldquo;times seen&rdquo; is a minimum
          rather than a tally — use the dates to judge whether something is still happening.
        </p>
      )}

      {state === "ok" && !!store?.dropped && (
        <p className="mt-2 text-xs text-warning">
          {store.dropped} further {store.dropped === 1 ? "kind" : "kinds"} of violation could not be
          recorded — the list is full, so this is not the whole picture.
        </p>
      )}

      {state === "ok" && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={load}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-background"
          >
            Refresh
          </button>
          <span className="text-[11px] text-faint">
            {store?.updatedAt
              ? `Last report ${new Date(store.updatedAt).toLocaleString()}`
              : "No reports yet"}
          </span>
        </div>
      )}
    </section>
  );
}

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
        // four cards, so plain source-order auto-placement rather than a
        // hand-split masonry
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <TaskTypesSection />
          <TagsSection isAdmin={isAdmin} />
          <OccasionsSettings />
          <CspReportsSection />
        </div>
      )}

      {/* One column, not the two-up grid the Studio tab uses: the email editor
          is several times taller than the form card, so side by side would put
          a card and a column of empty space next to each other. */}
      {tab === "intake" && isAdmin && (
        <div className="flex max-w-[860px] flex-col gap-4">
          <IntakeSettings />
          <ClientEmailSettings />
          {/* ⚠️ Its own wording, not the same message with a word changed: this
              one reaches someone whose brief the studio may already be working
              on, and "your brief reached us" would read as though nobody
              noticed they had changed anything. */}
          <ClientEmailSettings
            settingKey="intake_seen_update_email"
            fallback={SEEN_UPDATE_EMAIL_DEFAULT}
            title="Email when a client updates a brief"
            blurb={
              <>
                Sent instead of the message above when you press{" "}
                <span className="font-medium">Tell client we&apos;ve seen it</span> on a brief the
                client has changed since sending it.
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
