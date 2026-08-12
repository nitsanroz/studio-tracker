"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, Paperclip, Plus, X } from "lucide-react";
import { normalizeUrl } from "@/lib/links";
import { MAX_INTAKE_BYTES, MAX_INTAKE_FILES, describeUpload, formatSize } from "@/lib/uploads";
import {
  CLOSING_ASKS,
  FIELDS,
  WORK_KINDS,
  kindById,
  type IntakeField,
} from "@/lib/intake-fields";

const inputCls =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand bidi-auto";

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
const CONTACT_FIELDS = ["name", "email", "company"] as const;

type Values = Record<string, string>;
interface DraftLink {
  title: string;
  url: string;
}
interface DraftDeliverable {
  name: string;
  details: string;
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
      <label htmlFor={id} className="text-sm font-medium">
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
        <span id={errId} className="text-xs text-danger">
          {invalid}
        </span>
      )}
    </div>
  );
}

/* ──────────────────────────────── the kinds ─────────────────────────────── */

/**
 * ⚠️ Native radios, not styled buttons. This is the one choice that decides
 * what the rest of the form asks, so it has to work with a keyboard, arrow
 * keys and a screen reader without any help from us.
 */
function KindPicker({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: string;
}) {
  return (
    <fieldset aria-describedby={invalid ? "kind-err" : undefined}>
      <legend className="mb-2 text-sm font-medium">
        What kind of work is this?
        <span className="text-danger" aria-hidden="true">
          {" "}
          *
        </span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {WORK_KINDS.map((k) => (
          <label
            key={k.id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
              value === k.id ? "border-brand bg-brand/5" : "border-border-strong hover:border-brand"
            }`}
          >
            <input
              type="radio"
              name="kind"
              value={k.id}
              checked={value === k.id}
              onChange={() => onChange(k.id)}
              className="mt-1 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="block text-xs text-faint">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {invalid && (
        <span id="kind-err" className="mt-1 block text-xs text-danger">
          {invalid}
        </span>
      )}
    </fieldset>
  );
}

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
  const set = (i: number, patch: Partial<DraftDeliverable>) =>
    onChange(items.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Is this several pieces?</span>
      <span className="-mt-1 text-xs text-faint">
        Name each one — “Roll-up 1”, “Front”, “Homepage banner” — and we’ll keep them apart in the
        brief. Skip it if it’s a single piece.
      </span>
      {items.map((d, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-border-strong p-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              value={d.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="Name — e.g. Roll-up 1"
              aria-label={`Piece ${i + 1} name`}
              className={inputCls}
              maxLength={80}
            />
            <textarea
              value={d.details}
              onChange={(e) => set(i, { details: e.target.value })}
              placeholder="What’s on it?"
              aria-label={`Piece ${i + 1} details`}
              rows={2}
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, n) => n !== i))}
            aria-label={`Remove piece ${i + 1}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger sm:size-9"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {items.length < 10 && (
        <button
          type="button"
          onClick={() => onChange([...items, { name: "", details: "" }])}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm text-muted hover:border-brand hover:text-brand sm:min-h-0 sm:py-1.5"
        >
          <Plus size={14} />
          {items.length ? "Add another piece" : "Add a piece"}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────── links & files ──────────────────────────── */

function LinkRows({ links, onChange }: { links: DraftLink[]; onChange: (l: DraftLink[]) => void }) {
  const set = (i: number, patch: Partial<DraftLink>) =>
    onChange(links.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Links</span>
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
              <span className="text-xs text-danger">
                That doesn&apos;t look like a web address — it should start with http:// or https://
              </span>
            )}
          </div>
        );
      })}
      {links.length < 8 && (
        <button
          type="button"
          onClick={() => onChange([...links, { title: "", url: "" }])}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm text-muted hover:border-brand hover:text-brand sm:min-h-0 sm:py-1.5"
        >
          <Plus size={14} />
          Add link
        </button>
      )}
      <span className="text-xs text-faint">
        <Link2 size={11} className="mr-1 inline" />A Drive folder, a WeTransfer, a reference — give
        it a name so we know what we&apos;re opening.
      </span>
    </div>
  );
}

/**
 * ⚠️ A bare `<input type="file" multiple>` REPLACES its selection on every
 * pick, so choosing files one at a time silently discarded all but the last —
 * which is why a form promising five files appeared to take one. The input is
 * only a trigger; this array is the truth, and `handleSubmit` copies it into
 * the FormData by hand.
 */
function FileRows({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);

  function add(picked: FileList | null) {
    if (!picked?.length) return;
    const accepted: File[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of picked) {
      // Same file twice is a mis-click, not an instruction to attach it twice.
      if (files.some((f) => f.name === file.name && f.size === file.size)) continue;
      if (files.length + accepted.length >= MAX_INTAKE_FILES) {
        rejected.push({ name: file.name, reason: `Only ${MAX_INTAKE_FILES} files can be attached.` });
        continue;
      }
      const check = describeUpload(file);
      if (check.ok) accepted.push(file);
      else rejected.push({ name: file.name, reason: check.reason });
    }
    onChange([...files, ...accepted]);
    setRefused(rejected);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Any files to add?</span>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${f.size}-${i}`}
          className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2"
        >
          <Paperclip size={14} className="shrink-0 text-faint" />
          <span className="bidi-auto min-w-0 flex-1 truncate text-sm">{f.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-faint">{formatSize(f.size)}</span>
          <button
            type="button"
            onClick={() => {
              onChange(files.filter((_, n) => n !== i));
              setRefused([]);
            }}
            aria-label={`Remove ${f.name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-faint hover:text-danger sm:size-9"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {refused.map((r, i) => (
        <span key={i} className="text-xs text-danger" role="alert">
          <span className="bidi-auto font-medium">{r.name}</span> — {r.reason}
        </span>
      ))}
      {files.length < MAX_INTAKE_FILES && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm text-muted hover:border-brand hover:text-brand sm:min-h-0 sm:py-1.5"
        >
          <Plus size={14} />
          {files.length ? "Add another file" : "Add files"}
        </button>
      )}
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
      <span className="text-xs text-faint">
        Up to {MAX_INTAKE_FILES} files, {formatSize(MAX_INTAKE_BYTES)} each — for anything larger,
        add a link above.
      </span>
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
}

/**
 * ⚠️ The steps are computed from the chosen kind, not fixed. That is the whole
 * justification for stepping the form at all: splitting the same 21 questions
 * across five screens would only add clicks. A "Logo or brand asset" skips the
 * Details step entirely because it has nothing to ask there, and a "Document"
 * never sees dimensions or animation.
 */
function stepsFor(kind: string): Step[] {
  const k = kindById(kind);
  const details = (k?.asks ?? []).filter((f) => f !== "content");
  const steps: Step[] = [
    { title: "About you", fields: [...CONTACT_FIELDS] },
    { title: "What you need", kindPicker: true, fields: ["taskName", "dueDate", "budgetRange"] },
  ];
  if (details.length) steps.push({ title: "Details", fields: details });
  steps.push({
    title: "The brief",
    fields: [
      "creativeBrief",
      "goal",
      "displayedWhere",
      "targetAudience",
      ...((k?.asks ?? []).includes("content") ? ["content"] : []),
    ],
    deliverables: k?.deliverables,
  });
  steps.push({ title: "Anything else", fields: [...CLOSING_ASKS], attachments: true });
  return steps;
}

/* ──────────────────────────────── the form ──────────────────────────────── */

export default function IntakeFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "form" | "invalid" | "sending" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Values>({});
  const [kind, setKind] = useState("");
  const [deliverables, setDeliverables] = useState<DraftDeliverable[]>([]);
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [remembered, setRemembered] = useState(false);

  const [step, setStep] = useState(0);
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps = useMemo(() => stepsFor(kind), [kind]);
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
  function checkStep(): boolean {
    const bad: Record<string, string> = {};
    if (current.kindPicker && !kind) bad.kind = "Pick one so we only ask what's relevant.";
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
    setState("sending");
    setError(null);
    const body = new FormData();
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    body.set("kind", kind);
    // Rows with no URL are someone who clicked "Add link" and thought better of
    // it — dropped here rather than rejected with an error.
    body.set("links", JSON.stringify(links.filter((l) => l.url.trim())));
    body.set(
      "deliverables",
      JSON.stringify(deliverables.filter((d) => d.name.trim() || d.details.trim())),
    );
    for (const f of files) body.append("files", f);

    const res = await fetch(`/api/intake/${token}`, { method: "POST", body });
    if (!res.ok) {
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
    setState("done");
  }

  if (state === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  }
  if (state === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">This link is no longer active — please contact the studio.</p>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Check size={24} />
          </div>
          <h1 className="mt-4 text-xl">Thank you! 🎉</h1>
          <p className="mt-1 text-sm text-muted">
            Your brief is with the studio. We&apos;ll be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
      <h1 className="text-xl">New Task Brief</h1>
      <p className="mt-1 text-sm text-muted">
        Tell us what you need — the more detail, the better the result.
      </p>

      {/* Progress. An ordered list so it reads as "step 2 of 5" rather than as
          decoration, with the current one marked for assistive tech. */}
      <nav aria-label="Progress" className="mt-5">
        <ol className="flex flex-wrap gap-1.5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex-1">
              <button
                type="button"
                // Going BACK is always allowed; going forward is not, or you
                // could skip the required fields the next step depends on.
                disabled={i > step}
                onClick={() => i < step && go(i)}
                aria-current={i === step ? "step" : undefined}
                className={`h-1.5 w-full rounded-full transition-colors ${
                  i <= step ? "bg-brand" : "bg-border-strong"
                } ${i < step ? "cursor-pointer" : ""}`}
              >
                <span className="sr-only">
                  {`Step ${i + 1} of ${steps.length}: ${s.title}`}
                  {i === step ? " (current)" : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-faint">
          Step {step + 1} of {steps.length}
        </p>
      </nav>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-5" noValidate>
        {/* ⚠️ Labelled BY the heading rather than carrying its own `<legend>`.
            An sr-only legend plus a visible <h2> saying the same words makes a
            screen reader announce the step name twice. */}
        <fieldset className="flex flex-col gap-4" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="text-lg outline-none">
            {current.title}
          </h2>

          {step === 0 && (
            <p className="-mt-2 text-xs text-faint">
              Only fields marked * are required — anything you don&apos;t know yet, leave blank and
              we&apos;ll ask.
            </p>
          )}

          {current.kindPicker && (
            <KindPicker
              value={kind}
              onChange={(v) => {
                setKind(v);
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
              className="w-fit text-xs text-muted underline hover:text-brand"
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
              <FileRows files={files} onChange={setFiles} />
            </>
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

        <div className="flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="min-h-11 rounded-lg border border-border-strong px-4 text-sm hover:border-brand"
            >
              Back
            </button>
          )}
          {isLast ? (
            <button
              disabled={state === "sending"}
              className="min-h-11 flex-1 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Submit brief"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => checkStep() && go(step + 1)}
              className="min-h-11 flex-1 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
            >
              Next
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
