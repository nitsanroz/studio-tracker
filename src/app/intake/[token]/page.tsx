"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  ChartColumn,
  Check,
  FileText,
  Link2,
  MessageSquare,
  Monitor,
  Paperclip,
  Plus,
  Presentation,
  Puzzle,
  Shirt,
  Sparkles,
  Tent,
  X,
  type LucideIcon,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { AmpLoader } from "@/components/amp-loader";
import { SkeletonCard } from "@/components/skeleton";
import { normalizeUrl } from "@/lib/links";
import {
  MAX_INTAKE_FILES,
  MAX_INTAKE_TOTAL_BYTES,
  describeUpload,
  describeUploadSet,
  formatSize,
} from "@/lib/uploads";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import {
  CLOSING_ASKS,
  CONTACT_FIELDS,
  FIELDS,
  TECH_ALWAYS,
  WORK_KINDS,
  kindById,
  wantsDeliverables,
  type IntakeField,
} from "@/lib/intake-fields";

// ⚠️ `text-base`, not `text-sm`. This is a form filled by people outside the
// studio, often on a phone — and iOS Safari ZOOMS the whole page when a focused
// input's text is under 16px, which throws the layout around mid-answer.
//
// The 2026-11 look (design-lab round 7, direction A): a field is a Light White
// well with no outline, the refresh's quiet surface, and turns white with a
// brand ring when it has focus. ⚠️ This page is OUTSIDE `.app-canvas`, so none
// of the refresh's global rules reach it — every value here is set by hand.
const inputCls =
  "w-full rounded-xl bg-[var(--light-white)] px-4 py-3 text-base outline-none ring-brand placeholder:text-faint focus:bg-surface focus:ring-2 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger bidi-auto";
/** The same field sitting INSIDE a well (an open deliverable), so it stays visible. */
const inputOnWellCls = inputCls.replace("bg-[var(--light-white)]", "bg-surface");

/**
 * The kinds drawn in the app's own icon set. ⚠️ `WorkKind.icon` (the emoji) stays
 * in the data — the studio-side brief still uses it — and this map only decides
 * what the CLIENT sees here; an unknown id falls back to the puzzle piece.
 */
const KIND_ICON: Record<string, LucideIcon> = {
  social: MessageSquare,
  website: Monitor,
  event: Tent,
  presentation: Presentation,
  document: FileText,
  graphics: ChartColumn,
  swag: Shirt,
  logo: Sparkles,
  other: Puzzle,
};

/**
 * What this browser filled in last time — name, email, company only.
 *
 * ⚠️ Deliberately localStorage and NOT a server lookup. The obvious "profile a
 * repeat client" design is an endpoint that takes an email and returns the name
 * and company behind it — but this form is unauthenticated and its URL is
 * pasted into client emails, so that endpoint would hand anyone who guessed an
 * address the name and employer attached to it. Nothing here is worth that.
 *
 * ⚠️ Never store the brief itself, and that constraint SURVIVES the move to a
 * stepped form even though a draft-save is exactly what a wizard wants: a
 * shared machine at the client's office would leak one client's request into
 * the next person's form. Abandoning midway loses the answers, on purpose.
 */
const CONTACT_KEY = "intake:contact";

type Values = Record<string, string>;
interface DraftLink {
  title: string;
  url: string;
}
interface DraftDeliverable {
  /** Client-side only, for stable React keys and open/closed tracking. */
  id: string;
  name: string;
  details: string;
  dimensions: string;
  format: string;
}

let deliverableSeq = 0;
const newDeliverable = (): DraftDeliverable => ({
  id: `d${++deliverableSeq}`,
  name: "",
  details: "",
  dimensions: "",
  format: "",
});

/**
 * The briefs THIS BROWSER has submitted, so the client can duplicate or edit one.
 *
 * ⚠️ The unguessable `key` the server minted at submit is the ONLY authorisation,
 * and this is the only place it exists. Deliberately not "every brief sent from
 * this email address": the form is unauthenticated and its URL gets pasted into
 * client emails, so an email→briefs lookup would hand anyone holding the link the
 * brief text, name and employer behind any address they could guess. The cost is
 * that the same person on a second device sees nothing — the same trade the
 * contact memory above already makes, and the same reasoning that kept v1.14.0
 * from adding an email→identity endpoint.
 *
 * ⚠️ Keyed per intake TOKEN. One machine at an agency may hold links for two
 * clients, and one client's briefs must never be listed under another's form.
 * ⚠️ Note what is NOT stored: none of the brief's own content. Storing the
 * answers is exactly the shared-office leak the no-draft-save rule exists to
 * prevent; an id and a key reveal nothing without the server.
 */
const SENT_KEY = (token: string) => `intake:sent:${token}`;
const MAX_REMEMBERED = 20;

interface SentBrief {
  id: string;
  key: string;
  title: string;
  at: string;
}

function loadSent(token: string): SentBrief[] {
  try {
    const raw = localStorage.getItem(SENT_KEY(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((r) => {
      if (!r || typeof r !== "object") return [];
      const o = r as Record<string, unknown>;
      const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
      return str("id") && str("key") ? [{ id: str("id"), key: str("key"), title: str("title"), at: str("at") }] : [];
    });
  } catch {
    return [];
  }
}

function rememberSent(token: string, brief: SentBrief) {
  try {
    // Newest first, and an EDIT replaces its own entry rather than adding one.
    const next = [brief, ...loadSent(token).filter((b) => b.id !== brief.id)].slice(0, MAX_REMEMBERED);
    localStorage.setItem(SENT_KEY(token), JSON.stringify(next));
  } catch {
    /* remembering is a convenience; never fail a submission over it */
  }
}

function loadContact(): Values | null {
  try {
    const raw = localStorage.getItem(CONTACT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const c = { name: s("name"), email: s("email"), company: s("company") };
    return c.name || c.email ? c : null;
  } catch {
    return null; // private mode, disabled storage, or something else's key
  }
}

/* ─────────────────────────────── one question ───────────────────────────── */

function Question({
  field,
  value,
  onChange,
  invalid,
}: {
  field: IntakeField;
  value: string;
  onChange: (v: string) => void;
  invalid?: string;
}) {
  const id = `f-${field.key}`;
  const errId = `${id}-err`;
  const common = {
    id,
    name: field.key,
    value,
    className: inputCls,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": invalid ? errId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
  };
  return (
    <div className="flex flex-col gap-1">
      {/* An explicit htmlFor rather than a wrapping label: a wrapping label
          around a <select> swallows clicks on some browsers, and the error
          message needs an id to point at anyway. */}
      <label htmlFor={id} className="mb-0.5 text-[15px] font-medium">
        {field.label}
        {field.required && (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {field.type === "textarea" ? (
        <textarea {...common} rows={field.rows ?? 3} placeholder={field.placeholder} />
      ) : field.type === "select" ? (
        <select {...common}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={field.type === "date" ? "date" : field.key === "email" ? "email" : "text"}
          placeholder={field.placeholder}
          autoComplete={
            field.key === "name"
              ? "name"
              : field.key === "email"
                ? "email"
                : field.key === "company"
                  ? "organization"
                  : undefined
          }
        />
      )}
      {invalid && (
        <span id={errId} className="text-sm text-danger">
          {invalid}
        </span>
      )}
    </div>
  );
}

/* ──────────────────────────────── the kinds ─────────────────────────────── */

/**
 * ⚠️ Native checkboxes, not styled buttons. This is the choice that decides what
 * the rest of the form asks, so it has to work with a keyboard and a screen
 * reader without any help from us.
 *
 * ⚠️ MULTI-select. One task routinely holds pieces of different kinds — a
 * roll-up and a social post for the same event — and forcing one kind would
 * mean the client picks the nearest and never gets asked about the rest.
 * `fieldsAsked` takes the union.
 *
 * ⚠️ The icon is decorative and `aria-hidden`. It sits BESIDE the label, never
 * instead of it: an emoji is a nice glance-target and a terrible only-signal.
 */
function KindPicker({
  value,
  onChange,
  invalid,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  invalid?: string;
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset aria-describedby={invalid ? "kind-err" : undefined}>
      <legend className="text-[15px] font-medium">
        What kind of work is this?
        <span className="text-danger" aria-hidden="true">
          {" "}
          *
        </span>
      </legend>
      <p className="mb-3 text-sm text-muted">Pick as many as apply.</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {WORK_KINDS.map((k) => {
          const on = value.includes(k.id);
          const Icon = KIND_ICON[k.id] ?? Puzzle;
          return (
            <label
              key={k.id}
              // ⚠️ THE CHECKBOX IS STILL THE NATIVE ONE, only visually hidden
              // (`sr-only`), so a keyboard and a screen reader get exactly what
              // they got before. The tile shows its state; `has-[:focus-visible]`
              // puts the focus ring back on the tile, where the eye is.
              className={`relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 ${
                on ? "bg-brand-soft ring-2 ring-brand" : "bg-[var(--light-white)] hover:shadow-card"
              }`}
            >
              <input
                type="checkbox"
                name="kinds"
                value={k.id}
                checked={on}
                onChange={() => toggle(k.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                  on ? "bg-brand text-white" : "bg-surface text-brand"
                }`}
              >
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="min-w-0 pr-5">
                <span className="block text-[15px] font-medium leading-snug">{k.label}</span>
                {/* ⚠️ `text-muted`, not `text-faint`. The faint token is tuned
                    for the app's plain surfaces and disappears against the
                    tinted tile of a selected option. */}
                <span className="mt-0.5 block text-sm leading-snug text-muted">{k.hint}</span>
              </span>
              {on && (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-brand text-white"
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </div>
      {invalid && (
        <span id="kind-err" className="mt-1 block text-sm text-danger">
          {invalid}
        </span>
      )}
    </fieldset>
  );
}

/**
 * A block's heading: what it is on the left, the way to add one on the right.
 *
 * ⚠️ Shared by the three repeatable blocks so they can't drift apart. The
 * button sat under the description before, which pushed every "add" control to
 * a different vertical position depending on how long the copy above it ran.
 */
function BlockHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const addBtnCls =
  "flex min-h-11 w-fit items-center gap-1.5 rounded-xl bg-[var(--light-white)] px-3.5 text-base text-brand hover:bg-brand-soft sm:min-h-0 sm:py-2";

/* ───────────────────────────── the deliverables ─────────────────────────── */

/**
 * The named pieces inside one brief.
 *
 * ⚠️ This is the structured answer to something clients were already doing:
 * typing "Roll-up 1" and "Banner 2" as bare lines inside the brief box, where
 * nothing could tell them apart from the bullets beneath. Declared here, a name
 * is data — so it can be emphasised in the brief with certainty rather than
 * guessed at by a heuristic that would also embolden "Notraffic logo".
 */
function DeliverableRows({
  items,
  onChange,
}: {
  items: DraftDeliverable[];
  onChange: (d: DraftDeliverable[]) => void;
}) {
  // ⚠️ Which rows are OPEN, tracked by id rather than by index — removing the
  // first of three would otherwise silently re-open whichever row slid up into
  // its place. Seeded from whatever exists at first render, which is the one
  // row the parent starts with.
  const [open, setOpen] = useState<string[]>(() => items.map((d) => d.id));

  const set = (id: string, patch: Partial<DraftDeliverable>) =>
    onChange(items.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => {
    onChange(items.filter((d) => d.id !== id));
    setOpen((o) => o.filter((x) => x !== id));
  };
  const add = () => {
    const d = newDeliverable();
    onChange([...items, d]);
    setOpen((o) => [...o, d.id]);
  };

  return (
    <div className="flex flex-col gap-2">
      <BlockHeader
        title="Deliverables"
        hint="Name each one — “Roll-up 1”, “Front”, “Homepage banner” — and we’ll keep them apart in the brief."
        action={
          items.length < 10 ? (
            <button type="button" onClick={add} className={addBtnCls}>
              <Plus size={14} />
              Add deliverable
            </button>
          ) : null
        }
      />
      {items.map((d, i) => {
        const isOpen = open.includes(d.id);
        const spec = [d.dimensions, d.format].filter(Boolean).join(" · ");
        const empty = !d.name.trim() && !d.details.trim() && !spec;

        // ⚠️ Confirmed rows collapse to a summary. Left as live inputs, a list
        // of three deliverables is a wall of focused-looking boxes with no
        // sense of which are finished — Nitsan's note. Editing is one click
        // back, and nothing is lost by collapsing: the values are the same
        // state either way.
        if (!isOpen) {
          return (
            <div
              key={d.id}
              className="flex items-start gap-3 rounded-xl bg-[var(--light-white)] px-4 py-3"
            >
              <Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <span className="bidi-auto block text-base font-medium">
                  {d.name.trim() || `Deliverable ${i + 1}`}
                </span>
                {spec && <span className="block text-sm text-muted">{spec}</span>}
                {d.details.trim() && (
                  <span className="bidi-auto block whitespace-pre-wrap text-sm text-muted">
                    {d.details}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen((o) => [...o, d.id])}
                className="shrink-0 text-sm text-brand hover:underline"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(d.id)}
                aria-label={`Remove ${d.name.trim() || `deliverable ${i + 1}`}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger"
              >
                <X size={16} />
              </button>
            </div>
          );
        }

        return (
          <div key={d.id} className="flex items-start gap-2 rounded-2xl bg-[var(--light-white)] p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                value={d.name}
                onChange={(e) => set(d.id, { name: e.target.value })}
                placeholder="Name — e.g. Roll-up 1"
                aria-label={`Deliverable ${i + 1} name`}
                className={inputOnWellCls}
                maxLength={80}
              />
              {/* ⚠️ Its own size and format. A real set varies — the Partner
                  Event brief had Banner 1 at 79 × 47 inches and Banner 2 at
                  75 × 47 — and one shared dimensions field forces that
                  difference into prose, where it reads as description rather
                  than a spec. */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={d.dimensions}
                  onChange={(e) => set(d.id, { dimensions: e.target.value })}
                  placeholder="Its size, if different"
                  aria-label={`Deliverable ${i + 1} dimensions`}
                  className={`${inputOnWellCls} sm:flex-1`}
                  maxLength={120}
                />
                <input
                  value={d.format}
                  onChange={(e) => set(d.id, { format: e.target.value })}
                  placeholder="Its format, if different"
                  aria-label={`Deliverable ${i + 1} format`}
                  className={`${inputOnWellCls} sm:flex-1`}
                  maxLength={120}
                />
              </div>
              <textarea
                value={d.details}
                onChange={(e) => set(d.id, { details: e.target.value })}
                placeholder="What’s on it?"
                aria-label={`Deliverable ${i + 1} details`}
                rows={2}
                className={inputOnWellCls}
              />
              <button
                type="button"
                onClick={() => setOpen((o) => o.filter((x) => x !== d.id))}
                disabled={empty}
                className="min-h-11 w-fit rounded-xl bg-brand-soft px-4 text-base text-brand hover:bg-brand hover:text-white disabled:opacity-40 sm:min-h-0 sm:py-2"
              >
                Done
              </button>
            </div>
            <button
              type="button"
              onClick={() => remove(d.id)}
              aria-label={`Remove deliverable ${i + 1}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger sm:size-9"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── links & files ──────────────────────────── */

function LinkRows({ links, onChange }: { links: DraftLink[]; onChange: (l: DraftLink[]) => void }) {
  const set = (i: number, patch: Partial<DraftLink>) =>
    onChange(links.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-2">
      <BlockHeader
        title="Links"
        hint="A Drive folder, a WeTransfer, a reference — give it a name so we know what we’re opening."
        action={
          links.length < 8 ? (
            <button
              type="button"
              onClick={() => onChange([...links, { title: "", url: "" }])}
              className={addBtnCls}
            >
              <Plus size={14} />
              Add link
            </button>
          ) : null
        }
      />
      {links.map((l, i) => {
        // Shown only once there's something to judge, and only as a hint — the
        // server re-checks every URL anyway, and nagging someone mid-typing is
        // how you get an abandoned form.
        const bad = l.url.trim().length > 3 && !normalizeUrl(l.url);
        return (
          <div key={i} className="flex flex-col gap-1">
            {/* ⚠️ The two inputs STACK below `sm`. Side by side on a 375px
                screen the title took 235px and `flex-1` left the URL field
                **26px wide** — unusable, and this form is filled on a phone
                more often than not. */}
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={l.title}
                  onChange={(e) => set(i, { title: e.target.value })}
                  placeholder="What is it? e.g. Brand guidelines"
                  aria-label={`Link ${i + 1} title`}
                  className={`${inputCls} sm:w-2/5`}
                  maxLength={120}
                />
                <input
                  value={l.url}
                  onChange={(e) => set(i, { url: e.target.value })}
                  placeholder="https://…"
                  aria-label={`Link ${i + 1} address`}
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className={`${inputCls} sm:flex-1`}
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(links.filter((_, n) => n !== i))}
                aria-label={`Remove link ${i + 1}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger sm:size-9"
              >
                <X size={16} />
              </button>
            </div>
            {bad && (
              <span className="text-sm text-danger">
                That doesn&apos;t look like a web address — it should start with http:// or https://
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * ⚠️ A bare `<input type="file" multiple>` REPLACES its selection on every
 * pick, so choosing files one at a time silently discarded all but the last —
 * which is why a form promising five files appeared to take one. The input is
 * only a trigger; this array is the truth.
 *
 * ⚠️ EACH FILE UPLOADS THE MOMENT IT IS PICKED, straight into the bucket with a
 * signed URL, and the submission carries only its PATH. Two reasons, and the
 * first is why a client lost a brief: posting the bytes through the API meant
 * every attachment shared one 4.5MB request budget with the whole form, and a
 * body over that is dropped by the platform before any code runs, so nothing
 * could explain the failure (v1.19.2). The second is that uploading at SUBMIT
 * would put a 25MB wait behind the one button the client has already pressed —
 * here the transfer happens while they are still filling the form in, and the
 * row says where it has got to.
 */
type Attachment = {
  /** Stable across re-renders; the file name is not (two picks can share one). */
  key: string;
  name: string;
  size: number;
  /**
   * ⚠️ ABSENT for an attachment CARRIED OVER from a brief being duplicated or
   * edited: that object is already in the bucket, so there is no `File` and
   * nothing to upload. `name`/`size` therefore live on the attachment rather
   * than being read off the file — which is also why `size` can be 0 on a brief
   * submitted before v1.19.4, when the size was not recorded.
   */
  file?: File;
  state: "uploading" | "done" | "error";
  /** Set once stored. This, not the bytes, is what the submission posts. */
  path?: string;
  error?: string;
};

/**
 * ⚠️ The ANON client, on a page with no session — and that is fine: the write is
 * authorized by the single-use token the server mints in ./upload, not by the
 * key. Created once at module scope rather than per render, so a re-render
 * mid-upload cannot swap the client out from under a transfer in flight.
 */
const supabase = createClient();

function FileRows({
  token,
  files,
  onChange,
}: {
  token: string;
  files: Attachment[];
  onChange: (f: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);

  /**
   * ⚠️ Updates by KEY through the functional form, never by index into a
   * captured array: an upload finishing is async, and by then the client may
   * have removed a row or added two more, so an index would write the result
   * onto whatever file happens to sit there now.
   */
  async function upload(item: Attachment) {
    const fail = (reason: string) =>
      onChange((prev) =>
        prev.map((a) => (a.key === item.key ? { ...a, state: "error" as const, error: reason } : a)),
      );
    try {
      const res = await fetch(`/api/intake/${token}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, size: item.size }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return fail(j.error ?? "Couldn't start the upload.");

      const { error } = await supabase.storage
        .from("intake")
        .uploadToSignedUrl(j.path, j.token, item.file!, { contentType: j.contentType });
      if (error) return fail(`Upload failed — ${error.message}`);

      onChange((prev) =>
        prev.map((a) => (a.key === item.key ? { ...a, state: "done" as const, path: j.path } : a)),
      );
    } catch {
      // Offline, or the tab lost the network mid-transfer.
      fail("Upload failed — check your connection and try again.");
    }
  }

  function add(picked: FileList | null) {
    if (!picked?.length) return;
    const accepted: Attachment[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of picked) {
      // Same file twice is a mis-click, not an instruction to attach it twice.
      if (files.some((a) => a.name === file.name && a.size === file.size)) continue;
      if (files.length + accepted.length >= MAX_INTAKE_FILES) {
        rejected.push({ name: file.name, reason: `Only ${MAX_INTAKE_FILES} files can be attached.` });
        continue;
      }
      const check = describeUpload(file);
      if (!check.ok) {
        rejected.push({ name: file.name, reason: check.reason });
        continue;
      }
      // ⚠️ The BUDGET is weighed per file as it lands, against everything
      // already attached — before the upload starts, so a file that cannot be
      // part of the brief is never sent to storage in the first place.
      const set = describeUploadSet([
        ...files,
        ...accepted,
        { name: file.name, size: file.size },
      ]);
      if (!set.ok) {
        rejected.push({ name: file.name, reason: set.reason });
        continue;
      }
      accepted.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        file,
        state: "uploading",
      });
    }
    onChange([...files, ...accepted]);
    setRefused(rejected);
    for (const item of accepted) void upload(item);
  }

  return (
    <div className="flex flex-col gap-2">
      <BlockHeader
        title="Any files to add?"
        hint={`Up to ${MAX_INTAKE_FILES} files, ${formatSize(MAX_INTAKE_TOTAL_BYTES)} in total — for anything larger, add a link above.`}
        action={
          files.length < MAX_INTAKE_FILES ? (
            <button type="button" onClick={() => inputRef.current?.click()} className={addBtnCls}>
              <Plus size={14} />
              Add files
            </button>
          ) : null
        }
      />
      {files.map((a) => (
        <div
          key={a.key}
          className="flex items-center gap-2 rounded-xl bg-[var(--light-white)] px-4 py-2"
        >
          <Paperclip size={14} className="shrink-0 text-faint" />
          <span className="bidi-auto min-w-0 flex-1 truncate text-base">{a.name}</span>
          {/* The state of the transfer, in the row it belongs to. "Sending…"
              rather than a percentage: `uploadToSignedUrl` reports completion,
              not progress, and a fake bar is worse than an honest word. */}
          {a.state === "uploading" && <span className="shrink-0 text-sm text-muted">Sending…</span>}
          {a.state === "error" && (
            <span className="shrink-0 text-sm text-danger" role="alert">
              {a.error}
            </span>
          )}
          <span className="shrink-0 text-sm tabular-nums text-muted">{formatSize(a.size)}</span>
          <button
            type="button"
            onClick={() => {
              // ⚠️ Removed by KEY. Filtering by index would drop the wrong row
              // when an upload finishing has just re-ordered nothing but the
              // array identity — and the stored object is deliberately left in
              // the bucket: an orphan is much the cheaper mistake than deleting
              // a file a second brief is about to reference.
              onChange((prev) => prev.filter((x) => x.key !== a.key));
              setRefused([]);
            }}
            aria-label={`Remove ${a.name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger sm:size-9"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {refused.map((r, i) => (
        <span key={i} className="text-sm text-danger" role="alert">
          <span className="bidi-auto font-medium">{r.name}</span> — {r.reason}
        </span>
      ))}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          // ⚠️ Without this, picking the SAME file again fires no `change`
          // event — the value hasn't altered — so removing a file and re-adding
          // it would appear to do nothing.
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ──────────────────────────────── the steps ─────────────────────────────── */

interface Step {
  title: string;
  /** Field keys rendered on this step, in order. */
  fields: string[];
  /** Extra blocks this step owns. */
  kindPicker?: boolean;
  deliverables?: boolean;
  attachments?: boolean;
  review?: boolean;
}

/**
 * ⚠️ The steps are computed from the chosen kind, not fixed. That is the whole
 * justification for stepping the form at all: splitting the same 21 questions
 * across five screens would only add clicks. A "Logo or brand asset" skips the
 * Details step entirely because it has nothing to ask there, and a "Document"
 * never sees dimensions or animation.
 */
function stepsFor(kinds: string[]): Step[] {
  const picked = kinds.map(kindById).filter(Boolean);
  // The UNION of what every chosen kind asks — a task holding a roll-up and a
  // social post needs both sets.
  const asks = [...new Set(picked.flatMap((k) => k!.asks))];
  const details = asks.filter((f) => f !== "content");
  return [
    { title: "About you", fields: [...CONTACT_FIELDS] },
    { title: "What you need", kindPicker: true, fields: ["taskName", "dueDate", "budgetRange"] },
    // ⚠️ `TECH_ALWAYS` means this step always has something to ask, so it is
    // never skipped — the catch-all comments box is the point of it.
    { title: "Technical details", fields: [...details, ...TECH_ALWAYS] },
    {
      // ⚠️ `thingsToAvoid` lives HERE, straight after the goal, rather than
      // among the leftovers at the end: what to avoid is the other half of what
      // to aim for, and the client who has just written the goal is the one
      // holding the answer.
      title: "The brief",
      fields: ["creativeBrief", "goal", "thingsToAvoid", "displayedWhere", "targetAudience"],
    },
    {
      // Everything the client HANDS OVER, in one place — the copy, the named
      // deliverables, and the references that go with them. Splitting these
      // from the brief keeps that step to five questions instead of nine.
      title: "Content & references",
      fields: [...(asks.includes("content") ? ["content"] : []), ...CLOSING_ASKS],
      deliverables: wantsDeliverables(kinds),
      attachments: true,
    },
    { title: "Review & send", fields: [], review: true },
  ];
}

/**
 * What the client is about to send, before they send it.
 *
 * ⚠️ Reads from the SAME `values`/`kinds`/`deliverables` state the submission
 * builds its FormData from, never from a parallel description of it — a summary
 * assembled independently is a summary that can lie, and this one exists
 * precisely so the client can trust what leaves their hands.
 *
 * Only answered things appear. A review screen padded with "—" for everything
 * skipped teaches people to stop reading it.
 */
function Review({
  values,
  kinds,
  deliverables,
  links,
  files,
  steps,
  onEdit,
}: {
  values: Values;
  kinds: string[];
  deliverables: DraftDeliverable[];
  links: DraftLink[];
  files: Attachment[];
  steps: Step[];
  onEdit: (step: number) => void;
}) {
  const rows: { step: number; label: string; value: string }[] = [];
  steps.forEach((st, i) => {
    if (st.kindPicker && kinds.length) {
      rows.push({
        step: i,
        label: "Kind of work",
        value: kinds.map((k) => kindById(k)?.label ?? k).join(", "),
      });
    }
    for (const key of st.fields) {
      const v = (values[key] ?? "").trim();
      if (v && FIELDS[key]) rows.push({ step: i, label: FIELDS[key].label, value: v });
    }
  });

  const contentStep = steps.findIndex((st) => st.attachments);
  const named = deliverables.filter(
    (d) => d.name.trim() || d.details.trim() || d.dimensions.trim() || d.format.trim(),
  );
  const realLinks = links.filter((l) => l.url.trim());

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">
        Here&apos;s what we&apos;ll receive. Anything you skipped simply isn&apos;t shown — you can
        still send it as it is.
      </p>
      <dl className="divide-y divide-surface overflow-hidden rounded-2xl bg-[var(--light-white)]">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <dt className="w-36 shrink-0 text-sm text-muted">{r.label}</dt>
            <dd className="bidi-auto min-w-0 flex-1 whitespace-pre-wrap text-base">{r.value}</dd>
            <button
              type="button"
              onClick={() => onEdit(r.step)}
              className="shrink-0 text-sm text-brand hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
        {named.map((d, i) => (
          <div key={`d${i}`} className="flex items-start gap-3 px-4 py-3">
            <dt className="w-36 shrink-0 text-sm text-muted">
              {i === 0 ? "Deliverables" : ""}
            </dt>
            <dd className="min-w-0 flex-1 text-base">
              <span className="bidi-auto block font-medium">{d.name || "(unnamed)"}</span>
              {[d.dimensions, d.format].filter(Boolean).length > 0 && (
                <span className="block text-sm text-muted">
                  {[d.dimensions, d.format].filter(Boolean).join(" · ")}
                </span>
              )}
              {d.details && (
                <span className="bidi-auto block whitespace-pre-wrap text-sm">{d.details}</span>
              )}
            </dd>
            <button
              type="button"
              onClick={() => onEdit(contentStep)}
              className="shrink-0 text-sm text-brand hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
        {(realLinks.length > 0 || files.length > 0) && (
          <div className="flex items-start gap-3 px-4 py-3">
            <dt className="w-36 shrink-0 text-sm text-muted">Attached</dt>
            <dd className="min-w-0 flex-1 text-base">
              {realLinks.map((l, i) => (
                <span key={`l${i}`} className="bidi-auto block truncate">
                  <Link2 size={12} className="mr-1 inline" />
                  {l.title || l.url}
                </span>
              ))}
              {files.map((a) => (
                <span key={a.key} className="bidi-auto block truncate">
                  <Paperclip size={12} className="mr-1 inline" />
                  {a.name}{" "}
                  <span className="text-sm text-muted">{formatSize(a.size)}</span>
                  {/* The review page is the last thing read before sending, so
                      it has to show an attachment that is not actually going. */}
                  {a.state !== "done" && (
                    <span className={a.state === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
                      {a.state === "error" ? " — not uploaded" : " — sending…"}
                    </span>
                  )}
                </span>
              ))}
            </dd>
            <button
              type="button"
              onClick={() => onEdit(contentStep)}
              className="shrink-0 text-sm text-brand hover:underline"
            >
              Edit
            </button>
          </div>
        )}
      </dl>
    </div>
  );
}

/* ──────────────────────────────── the frame ─────────────────────────────── */

/** Every screen of the form shares this column (880px: six named steps fit one line). */
const PAGE = "mx-auto w-full max-w-[880px] px-5 py-8 sm:py-10";
/** The refresh's card — 20px radius, no outline, the soft shadow. */
const CARD = "rounded-[20px] bg-surface p-5 shadow-card sm:p-8";
const PRIMARY_BTN =
  "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-medium text-white hover:bg-brand-dark disabled:opacity-50 sm:flex-none";
const SOFT_BTN =
  "min-h-11 rounded-xl bg-[var(--light-white)] px-4 text-base hover:bg-brand-soft hover:text-brand";

/**
 * The studio's mark, top right on every screen. It identifies the sender; the
 * form's own title is what the client came to read, so it stays small.
 * ⚠️ `.brand-ampmore` is a CSS mask of the real artwork (`globals.css`) — the
 * earlier version typed "&more" in bold Saans, which is not the logo.
 */
function BriefHeader() {
  return (
    <div className="mb-8 flex justify-end">
      <span className="brand-ampmore h-6 bg-brand" role="img" aria-label="Studio&more" />
    </div>
  );
}

/* ──────────────────────────────── the form ──────────────────────────────── */

export default function IntakeFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  /**
   * ⚠️ `choose` is a SCREEN, not a step. Adding a conditional step would shift
   * every index the step machine already reasons about — `stepsFor`, `checkStep`,
   * the focus effect, the review step's Edit buttons — for a screen that is shown
   * once and only to a returning client.
   */
  const [state, setState] = useState<
    "loading" | "form" | "invalid" | "sending" | "done" | "choose"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Values>({});
  const [kinds, setKinds] = useState<string[]>([]);
  // ⚠️ Starts with ONE row, already open. An empty block with only an "Add"
  // button asks the client to opt in to describing the thing they came here to
  // describe; an open form asks them to fill it. Rows with nothing in them are
  // dropped at submit, so a client who ignores it costs nothing.
  const [deliverables, setDeliverables] = useState<DraftDeliverable[]>(() => [newDeliverable()]);
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [remembered, setRemembered] = useState(false);

  const [step, setStep] = useState(0);
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  /** Briefs this browser has sent through THIS link; empty for a first-timer. */
  const [sent, setSent] = useState<SentBrief[]>([]);
  /**
   * Set once the chooser has been answered, so pressing Back to the details step
   * and Next again does not ask the same question twice.
   */
  const [chose, setChose] = useState(false);
  /**
   * The brief being EDITED, if any. Its presence turns the submission into an
   * update — carried as state rather than derived, because a duplicate reads the
   * very same brief and must NOT become one.
   */
  /**
   * The brief being EDITED, if any. Its presence turns the submission into an
   * update — carried as state rather than derived, because a duplicate reads the
   * very same brief and must NOT become one.
   *
   * ⚠️ `started` lives INSIDE it (the studio has already made this a task, so the
   * warning changes but the flow does not). It was a second `useState`, which
   * meant every place clearing `editing` had to remember to clear that too —
   * three call sites doing it by hand, and only ever read inside `{editing && …}`
   * anyway. One object cannot fall out of step with itself.
   */
  const [editing, setEditing] = useState<{ id: string; key: string; started: boolean } | null>(
    null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps = useMemo(() => stepsFor(kinds), [kinds]);
  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;

  const set = (k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setInvalid((prev) => (prev[k] ? { ...prev, [k]: "" } : prev));
  };

  useEffect(() => {
    fetch(`/api/intake/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        const saved = loadContact();
        setClientName(j.clientName);
        // The link's own client wins for Company — that is the studio's record
        // of who this form belongs to, and it beats whatever was typed last time.
        setValues({
          name: saved?.name ?? "",
          email: saved?.email ?? "",
          company: j.clientName ?? saved?.company ?? "",
        });
        setRemembered(Boolean(saved));
        setSent(loadSent(token));
        setState("form");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  function forgetMe() {
    try {
      localStorage.removeItem(CONTACT_KEY);
    } catch {
      /* storage may be unavailable; the fields still clear */
    }
    setValues((v) => ({ ...v, name: "", email: "", company: clientName ?? "" }));
    setRemembered(false);
  }

  /** Validates the step being left. Returns true when it's safe to advance. */
  /**
   * Fills the form from a brief the client already sent — for a duplicate or an
   * edit. `asEdit` is the only difference between the two paths, and it decides
   * whether the submission updates that brief or creates a new one.
   *
   * ⚠️ Attachments are carried over as PATHS to the very same storage objects,
   * not re-uploaded: a duplicated brief costs nothing, and the sweep script
   * counts an object referenced by two briefs as live. They arrive `done`, so
   * the submit gate that waits for uploads passes straight through.
   */
  async function reuse(brief: SentBrief, asEdit: boolean) {
    setError(null);
    setState("loading");
    try {
      const res = await fetch(`/api/intake/${token}/briefs/${brief.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: brief.key }),
      });
      if (!res.ok) throw new Error("gone");
      const j = (await res.json()) as {
        answers: Record<string, unknown>;
        files: { name: string; path: string; size: number }[];
        editable: boolean;
      };
      // ⚠️ NO editable gate any more. A client may revise a brief the studio has
      // already turned into a task — that is the point of the revision flow — and
      // the task is never touched by it. `j.editable` is still returned and is
      // what the banner below uses to warn that work is already under way.
      const alreadyATask = asEdit && !j.editable;
      const a = j.answers;
      const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
      // ⚠️ Only the fields the FORM owns. Anything the studio has since added to
      // the row is not the client's to read back.
      const next: Values = {};
      for (const k of Object.keys(FIELDS)) next[k] = str(k);
      // Name and email stay as typed on the details step just now — the person
      // duplicating a colleague's brief is not that colleague.
      next.name = values.name;
      next.email = values.email;
      next.company = values.company;
      setValues(next);
      setKinds(Array.isArray(a.kinds) ? (a.kinds as string[]).filter((k) => typeof k === "string") : []);
      setLinks(
        Array.isArray(a.links)
          ? (a.links as { title?: string; url?: string }[]).map((l) => ({
              title: l.title ?? "",
              url: l.url ?? "",
            }))
          : [],
      );
      const ds = Array.isArray(a.deliverables) ? (a.deliverables as Record<string, string>[]) : [];
      setDeliverables(
        ds.length
          ? ds.map((d) => ({ ...newDeliverable(), name: d.name ?? "", details: d.details ?? "", dimensions: d.dimensions ?? "", format: d.format ?? "" }))
          : [newDeliverable()],
      );
      setFiles(
        j.files.map((f, i) => ({
          key: `carried-${brief.id}-${i}`,
          name: f.name,
          size: f.size,
          state: "done" as const,
          path: f.path,
        })),
      );
      setEditing(asEdit ? { id: brief.id, key: brief.key, started: alreadyATask } : null);
      setChose(true);
      setStep(1);
      setState("form");
    } catch {
      setState("choose");
      setError("That brief can't be opened any more — you can start a new one.");
    }
  }

  function checkStep(): boolean {
    const bad: Record<string, string> = {};
    if (current.kindPicker && !kinds.length)
      bad.kind = "Pick at least one, so we only ask what's relevant.";
    for (const key of current.fields) {
      const field = FIELDS[key];
      if (!field?.required) continue;
      const v = (values[key] ?? "").trim();
      if (!v) bad[key] = `${field.label} is needed.`;
      else if (key === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
        bad[key] = "That doesn't look like an email address.";
    }
    setInvalid(bad);
    return Object.keys(bad).length === 0;
  }

  function go(to: number) {
    setStep(to);
  }

  /**
   * Move focus to the new step's heading.
   *
   * ⚠️ In an effect keyed on `step`, NOT in the click handler. Focusing inside
   * `go()` — even wrapped in `requestAnimationFrame` — runs before React has
   * committed the new step, and the focus lands nowhere: verified in the
   * browser, where `document.activeElement` was still `<body>` after pressing
   * Next. Without this a keyboard or screen-reader user presses Next and is
   * left on a button that no longer describes anything, with nothing announcing
   * that the page changed.
   *
   * ⚠️ Skipped on first render, or arriving at the form would rip focus away
   * from wherever the browser put it.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!checkStep()) return;
    // ⚠️ Attachments are uploaded as they are picked, so submitting is only
    // allowed once every one of them has LANDED. Posting mid-transfer would
    // reference a path storage does not have yet, and the route would correctly
    // record it as "the upload didn't finish" — a brief silently short an
    // attachment, which is the failure this whole area exists to prevent.
    if (files.some((a) => a.state === "uploading")) {
      setError("Still sending your files — one moment.");
      return;
    }
    const failed = files.filter((a) => a.state === "error");
    if (failed.length) {
      setError(
        `Couldn't upload ${failed.map((a) => a.name).join(", ")} — remove ${failed.length === 1 ? "it" : "them"} or try again before sending.`,
      );
      return;
    }
    setState("sending");
    setError(null);
    const body = new FormData();
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    body.set("kinds", JSON.stringify(kinds));
    // Rows with no URL are someone who clicked "Add link" and thought better of
    // it — dropped here rather than rejected with an error.
    body.set("links", JSON.stringify(links.filter((l) => l.url.trim())));
    // ⚠️ `id` is a client-side key and must not be sent; and a row counts as
    // real if ANY of its four fields was filled, not just the name — the always
    // present first row is otherwise dropped when someone types only a size.
    body.set(
      "deliverables",
      JSON.stringify(
        deliverables
          .filter((d) => d.name.trim() || d.details.trim() || d.dimensions.trim() || d.format.trim())
          .map((d) => ({
            name: d.name,
            details: d.details,
            dimensions: d.dimensions,
            format: d.format,
          })),
      ),
    );
    // ⚠️ PATHS, not bytes. The files are already in the bucket; sending them
    // again is what put this request over the platform's 4.5MB body limit and
    // lost a client's brief.
    body.set(
      "uploaded",
      JSON.stringify(files.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name }))),
    );
    // Turns the submission into an update of that brief. The server re-checks
    // the key, the link and that it is still pending — this is a request, not a
    // permission.
    if (editing) {
      body.set("editId", editing.id);
      body.set("editKey", editing.key);
    }

    // ⚠️ A network failure must hand the form back, not leave the CLIENT on a
    // dead "Sending…" button with their brief unsent.
    const res = await fetch(`/api/intake/${token}`, { method: "POST", body }).catch(() => null);
    if (!res) {
      setError("We couldn't reach the studio — check your connection and send again. Nothing you typed is lost.");
      setState("form");
      return;
    }
    if (!res.ok) {
      // ⚠️ 413 comes from the PLATFORM, not from the route — the function is
      // never invoked, so there is no `{error}` to read and the old code fell
      // through to "Something went wrong", which tells a client nothing they
      // can act on. It cost one real brief on 2026-08-17. The check above should
      // make this unreachable; it is here for the client running a stale copy of
      // this page, who would otherwise get the same dead end.
      if (res.status === 413) {
        setError(
          "Those attachments were too large to send together — remove the biggest one, or add it as a WeTransfer or Drive link instead.",
        );
        setState("form");
        return;
      }
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong — please try again.");
      setState("form");
      return;
    }
    try {
      localStorage.setItem(
        CONTACT_KEY,
        JSON.stringify({ name: values.name, email: values.email, company: values.company }),
      );
    } catch {
      /* remembering is a convenience; never fail a submission over it */
    }
    // ⚠️ The key comes back exactly once, on the response to this submit, and is
    // never readable again — so if it is not stored here the brief can never be
    // edited. An edit returns the same id and key, and `rememberSent` replaces
    // that entry rather than adding a second one.
    const saved = (await res.json().catch(() => ({}))) as { id?: string; editKey?: string };
    if (saved.id && saved.editKey) {
      rememberSent(token, {
        id: saved.id,
        key: saved.editKey,
        title: values.taskName ?? "",
        at: new Date().toISOString(),
      });
      setSent(loadSent(token));
    }
    setEditing(null);
    setState("done");
  }

  if (state === "loading") {
    return (
      <div className={PAGE}>
        <BriefHeader />
        <SkeletonCard rows={4} className="mt-24" />
      </div>
    );
  }
  if (state === "invalid") {
    return (
      <div className={PAGE}>
        <BriefHeader />
        <section className={`${CARD} mt-24 text-center`}>
          <p className="text-base text-muted">This link is no longer active — please contact the studio.</p>
        </section>
      </div>
    );
  }
  /**
   * The returning client's chooser: start fresh, copy one they sent, or change
   * one the studio hasn't picked up yet.
   *
   * ⚠️ Every brief listed here was submitted FROM THIS BROWSER — the list comes
   * from localStorage and the server only confirms the ones whose key matches.
   * Someone opening a forwarded link sees this screen not at all.
   */
  if (state === "choose") {
    return (
      <div className={PAGE}>
        <BriefHeader />
        <h1 className="page-title bidi-auto">
          Welcome back
          {values.name && (
            <>
              , <span className="font-serif-accent">{values.name.split(" ")[0]}</span>
            </>
          )}
        </h1>
        <p className="mt-2 text-base text-muted">
          You&apos;ve sent {sent.length === 1 ? "a brief" : `${sent.length} briefs`} from this
          device. Start something new, or pick one up.
        </p>
        {error && (
          <p className="mt-3 text-base text-danger" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setChose(true);
            setEditing(null);
            setState("form");
            go(1);
          }}
          className="mt-6 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-brand px-5 text-base font-medium text-white shadow-card hover:bg-brand-dark"
        >
          <Plus size={18} />
          Start a new brief
          <StudioArrow size={18} className="ml-auto" />
        </button>

        <ul className="mt-6 flex flex-col gap-2">
          {sent.map((b) => (
            <li
              key={b.id}
              className="rounded-2xl bg-surface p-4 shadow-card sm:flex sm:items-center sm:gap-3 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="bidi-auto truncate text-base font-medium">{b.title || "Untitled brief"}</p>
                <p className="text-sm text-muted">{b.at ? formatDate(b.at) : ""}</p>
              </div>
              {/* ⚠️ Two verbs, never one. "Duplicate" starts a new brief from
                  this one — which is what a series like "Partner Event | Roll
                  ups / Banners / Flags" actually needs — while "Edit" changes
                  the brief the studio is holding. Collapsing them into "Re-use"
                  would leave the client guessing which happened. */}
              <div className="mt-3 flex gap-2 sm:mt-0">
                <button
                  type="button"
                  onClick={() => reuse(b, false)}
                  className={`${SOFT_BTN} flex-1 sm:flex-none`}
                >
                  Duplicate
                </button>
                {/* ⚠️ Always offered, whatever the studio has done with it. A
                    client with one more file for a job already under way is the
                    commonest revision there is, and the flow protects the task —
                    so refusing here would send them to email instead. What has
                    happened to the brief is explained once it is open, where
                    there is room to say it properly. */}
                <button
                  type="button"
                  onClick={() => reuse(b, true)}
                  className={`${SOFT_BTN} flex-1 sm:flex-none`}
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setState("form")}
          className="mt-6 text-base text-brand hover:underline"
        >
          Back to my details
        </button>
      </div>
    );
  }

  if (state === "done") {
    const firstName = (values.name ?? "").trim().split(" ")[0];
    return (
      // The whole screen in brand blue with the animated ampersand (2026-11,
      // design-lab direction C's ending on A's form): the one moment the form
      // can afford to be the studio rather than a form. ⚠️ `AmpLoader` is WHITE,
      // which is why it only ever sits on brand blue.
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand px-5 py-12 text-center text-white">
        <AmpLoader size={160} />
        <h1 className="bidi-auto mt-6 text-[32px] font-medium leading-[40px] tracking-[-0.025em] sm:text-[40px] sm:leading-[48px]">
          Thank you
          {firstName && (
            <>
              , <span className="font-serif-accent">{firstName}</span>
            </>
          )}
        </h1>
        <p className="mt-2 max-w-md text-base text-white/80">
          Your brief is with the studio. We&apos;ll be in touch shortly.
        </p>
        {/* A returning client is told the door is still open — this is the one
            screen where they learn the form remembers them at all. */}
        {sent.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setValues((prev) => ({ ...prev }));
              setState("choose");
            }}
            className="mt-8 flex min-h-12 items-center gap-2 rounded-xl bg-white px-6 text-base font-medium text-brand hover:bg-brand-soft"
          >
            Send another, or change one you&apos;ve sent
            <StudioArrow size={18} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <BriefHeader />
      {/* ⚠️ Editing has to be VISIBLE for the whole form, not just on the button
          at the end: everything on screen is a brief the studio is already
          holding, and a client who thinks they are writing a new one would send
          their next job as a revision of the last. */}
      {editing && (
        <div className="mb-6 rounded-2xl bg-brand-soft px-5 py-4 text-base">
          {editing.started ? (
            // ⚠️ Honest about what a late change can and cannot do. The studio may
            // already have drawn something, so promising "sending will replace it"
            // would be a lie — the change goes to them to look at.
            <>
              The studio has already started on this one. Your changes will be sent to them to
              review, so add a note if something important has moved.{" "}
            </>
          ) : (
            <>You&apos;re editing a brief you already sent. Sending will replace it. </>
          )}
          <button
            type="button"
            onClick={() => setState("choose")}
            className="text-brand underline"
          >
            Pick a different one
          </button>
        </div>
      )}
      <h1 className="page-title">
        New task <span className="font-serif-accent">brief</span>
      </h1>
      <p className="mt-2 text-base text-muted">
        Tell us what you need — the more detail, the better the result.
      </p>

      {/* Progress. An ordered list so it reads as "step 2 of 5" rather than as
          decoration, with the current one marked for assistive tech. */}
      {/* The steps, NAMED (2026-11, direction A): done ones carry a tick and
          take you back, the current one is solid brand, the rest are quiet.
          ⚠️ On a phone only the current step keeps its name — six named chips
          wrap to three lines at 375px — and the others shrink to their number. */}
      <nav aria-label="Progress" className="mt-6">
        <ol className="flex flex-wrap gap-1">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                // Going BACK is always allowed; going forward is not, or you
                // could skip the required fields the next step depends on.
                disabled={i > step}
                onClick={() => i < step && go(i)}
                aria-current={i === step ? "step" : undefined}
                className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors ${
                  i === step
                    ? "bg-brand text-white"
                    : i < step
                      ? "cursor-pointer bg-surface text-brand shadow-card hover:bg-brand-soft"
                      : "text-faint"
                }`}
              >
                {i < step ? (
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                ) : (
                  <span aria-hidden="true" className="tabular-nums">
                    {i + 1}
                  </span>
                )}
                <span aria-hidden="true" className={i === step ? "" : "hidden sm:inline"}>
                  {s.title}
                </span>
                <span className="sr-only">
                  {`Step ${i + 1} of ${steps.length}: ${s.title}`}
                  {i === step ? " (current)" : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <form
        onSubmit={handleSubmit}
        className={`${CARD} mt-4 flex flex-col gap-6`}
        noValidate
      >
        {/* ⚠️ Labelled BY the heading rather than carrying its own `<legend>`.
            An sr-only legend plus a visible <h2> saying the same words makes a
            screen reader announce the step name twice. */}
        <fieldset className="flex flex-col gap-5" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="card-title outline-none">
            {current.title}
          </h2>

          {step === 0 && (
            <p className="-mt-2 text-sm text-muted">
              Only fields marked * are required — anything you don&apos;t know yet, leave blank and
              we&apos;ll ask.
            </p>
          )}

          {current.kindPicker && (
            <KindPicker
              value={kinds}
              onChange={(v) => {
                setKinds(v);
                setInvalid((p) => ({ ...p, kind: "" }));
              }}
              invalid={invalid.kind}
            />
          )}

          {current.fields.map((key) =>
            FIELDS[key] ? (
              <Question
                key={key}
                field={FIELDS[key]}
                value={values[key] ?? ""}
                onChange={(v) => set(key, v)}
                invalid={invalid[key]}
              />
            ) : null,
          )}

          {step === 0 && remembered && (
            <button
              type="button"
              onClick={forgetMe}
              className="w-fit text-sm text-muted underline hover:text-brand"
            >
              Not you? Clear these details
            </button>
          )}

          {current.deliverables && (
            <DeliverableRows items={deliverables} onChange={setDeliverables} />
          )}

          {current.attachments && (
            <>
              <LinkRows links={links} onChange={setLinks} />
              <FileRows token={token} files={files} onChange={setFiles} />
            </>
          )}

          {current.review && (
            <Review
              values={values}
              kinds={kinds}
              deliverables={deliverables}
              links={links}
              files={files}
              steps={steps}
              onEdit={go}
            />
          )}
        </fieldset>

        {/* ⚠️ role="alert" — a failed submit used to render silently, so a
            screen-reader user got no indication at all that anything went
            wrong. */}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="min-h-12 rounded-xl px-5 text-base text-muted hover:bg-[var(--light-white)] hover:text-foreground"
            >
              Back
            </button>
          )}
          {/* ⚠️ DISTINCT `key`s, and this is not cosmetic. Without them React
              reuses the same DOM button when the step changes, so pressing Next
              into the final step turned that very element into a submit button
              mid-click — and the browser then applied the click's default
              action to the button as it had just become, submitting a form the
              client had only just arrived at. It looked like the form
              "jumped to the success screen by itself after two seconds".
              Separate keys force a new element, so the in-flight click belongs
              to the old, discarded one. */}
          {isLast ? (
            <button
              key="submit"
              type="submit"
              disabled={state === "sending"}
              className={PRIMARY_BTN}
            >
              {state === "sending" ? "Sending…" : editing ? "Save changes" : "Submit brief"}
              {state !== "sending" && <StudioArrow size={18} />}
            </button>
          ) : (
            <button
              key="next"
              type="button"
              onClick={() => {
                if (!checkStep()) return;
                // ⚠️ The chooser interrupts exactly ONCE, leaving the details
                // step, and only for a browser that has sent something before.
                // Asked any later it would mean discarding answers already
                // typed; asked before the details it would greet a stranger
                // with a list of briefs they cannot see.
                if (step === 0 && !chose && sent.length > 0) {
                  setState("choose");
                  return;
                }
                go(step + 1);
              }}
              className={PRIMARY_BTN}
            >
              Next
              <StudioArrow size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
