"use client";

import { use, useEffect, useState } from "react";
import { Link2, Plus, X } from "lucide-react";
import { normalizeUrl } from "@/lib/links";

const inputCls =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand bidi-auto";
const labelCls = "flex flex-col gap-1 text-sm font-medium";

/**
 * What this browser filled in last time — name, email, company only.
 *
 * ⚠️ Deliberately localStorage and NOT a server lookup. The obvious "profile a
 * repeat client" design is an endpoint that takes an email and returns the name
 * and company behind it — but this form is unauthenticated and its URL is
 * pasted into client emails, so that endpoint would hand anyone who guessed an
 * address the name and employer attached to it. Nothing here is worth that.
 *
 * Storing it on the client instead covers the case that actually recurs: the
 * same person at the same client submitting brief after brief from their own
 * laptop. It is their own data, in their own browser, and one click clears it.
 *
 * ⚠️ Never store the brief itself. A shared machine at the client's office
 * would leak one client's request into the next person's form.
 */
const CONTACT_KEY = "intake:contact";

interface Contact {
  name: string;
  email: string;
  company: string;
}

function loadContact(): Contact | null {
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={labelCls}>
      <span>
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

interface DraftLink {
  title: string;
  url: string;
}

/**
 * The client's own reference links — the counterpart of the studio's "+ Add
 * link" on a task brief (migration 0022).
 *
 * The same reasoning applies here as there: a Dropbox or Drive URL runs to a
 * couple of hundred unreadable characters, and pasting it into the Content box
 * turns the brief into noise. A title is what a designer needs to see.
 */
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
            <div className="flex items-center gap-2">
              <input
                value={l.title}
                onChange={(e) => set(i, { title: e.target.value })}
                placeholder="What is it? e.g. Brand guidelines"
                className={`${inputCls} sm:w-2/5`}
                maxLength={120}
              />
              <input
                value={l.url}
                onChange={(e) => set(i, { url: e.target.value })}
                placeholder="https://…"
                inputMode="url"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={() => onChange(links.filter((_, n) => n !== i))}
                aria-label="Remove this link"
                className="shrink-0 rounded-md p-2 text-faint hover:text-danger"
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
          className="flex w-fit items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={14} />
          Add link
        </button>
      )}
      <span className="text-xs text-faint">
        <Link2 size={11} className="mr-1 inline" />
        A Drive folder, a WeTransfer, a reference — give it a name so we know what we&apos;re
        opening.
      </span>
    </div>
  );
}

export default function IntakeFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "form" | "invalid" | "sending" | "done">("loading");
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<DraftLink[]>([]);

  // The three remembered fields are controlled, so "Not you?" can empty them.
  const [contact, setContact] = useState<Contact>({ name: "", email: "", company: "" });
  const [remembered, setRemembered] = useState(false);

  useEffect(() => {
    fetch(`/api/intake/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        const saved = loadContact();
        setClientName(j.clientName);
        // The link's own client wins for Company — that is the studio's record
        // of who this form belongs to, and it beats whatever was typed last time.
        setContact({
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
    setContact({ name: "", email: "", company: clientName ?? "" });
    setRemembered(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const body = new FormData(e.currentTarget);
    // Rows with no URL are someone who clicked "Add link" and thought better of
    // it — dropped here rather than rejected with an error.
    body.set("links", JSON.stringify(links.filter((l) => l.url.trim())));
    const res = await fetch(`/api/intake/${token}`, { method: "POST", body });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong — please try again.");
      setState("form");
      return;
    }
    try {
      localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
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
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
          <span className="brand-wordmark mx-auto w-44 bg-brand" />
          <h1 className="mt-4 text-xl">Thank you! 🎉</h1>
          <p className="mt-2 text-sm text-muted">
            Your task brief was received. The studio will review it and get back to you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-10">
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-border bg-surface p-8"
      >
        <span className="brand-wordmark w-44 bg-brand" />
        <div>
          <h1 className="text-xl">New Task Brief</h1>
          <p className="text-sm text-muted">
            {clientName
              ? `For ${clientName} — tell us what you need.`
              : "Tell us what you need — the more detail, the better the result."}
          </p>
          {/* Only three fields are required now, so say so once rather than
              letting people hunt for the asterisks. */}
          <p className="mt-1 text-xs text-faint">
            {/* ⚠️ The explicit {" "} matters: JSX strips the whitespace between
                an element and a newline, so without it this read "Only *fields". */}
            Only <span className="text-danger">*</span>{" "}
            fields are required — anything you don&apos;t know yet, leave blank and we&apos;ll ask.
          </p>
        </div>

        {remembered && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
            <span className="flex-1">Filled in from your last brief.</span>
            <button
              type="button"
              onClick={forgetMe}
              className="font-medium text-brand hover:underline"
            >
              Not you? Start blank
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input
              name="name"
              required
              value={contact.name}
              onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
              autoComplete="name"
              className={inputCls}
            />
          </Field>
          <Field label="Email" required>
            <input
              name="email"
              type="email"
              required
              value={contact.email}
              onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
              autoComplete="email"
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Company">
          <input
            name="company"
            value={contact.company}
            onChange={(e) => setContact((c) => ({ ...c, company: e.target.value }))}
            autoComplete="organization"
            className={inputCls}
          />
        </Field>
        <Field label="Task Name" required>
          <input name="taskName" required className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dimensions / Technical Specifications">
            <input name="dimensions" className={inputCls} placeholder="e.g. 1920×1080, A4 print…" />
          </Field>
          <Field label="Format">
            <input name="format" className={inputCls} placeholder="e.g. PNG, Figma, PDF…" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Would it be animated?">
            <select name="animated" className={inputCls} defaultValue="">
              <option value="">—</option>
              <option>Yes</option>
              <option>No</option>
              <option>Not sure yet</option>
            </select>
          </Field>
          <Field label="Due Date">
            <input name="dueDate" type="date" className={inputCls} />
          </Field>
        </div>
        <Field label="Budget Range (hours)">
          <input name="budgetRange" className={inputCls} placeholder="e.g. 5-8" />
        </Field>
        <Field label="Creative Brief">
          <textarea name="creativeBrief" rows={4} className={inputCls} />
        </Field>
        <Field label="What's the goal of this deliverable?">
          <textarea name="goal" rows={2} className={inputCls} />
        </Field>
        <Field label="Where would it be displayed?">
          <textarea name="displayedWhere" rows={2} className={inputCls} />
        </Field>
        <Field label="What's the target audience?">
          <textarea name="targetAudience" rows={2} className={inputCls} />
        </Field>
        <Field label="Things to avoid?">
          <textarea name="thingsToAvoid" rows={2} className={inputCls} />
        </Field>
        <Field label="Content">
          <textarea name="content" rows={3} className={inputCls} placeholder="Copy, texts…" />
        </Field>
        <Field label="Any files you need to add?">
          <input name="files" type="file" multiple className="text-sm" />
          <span className="text-xs text-faint">
            Up to 5 files, 10MB each — for anything larger, add a WeTransfer or Drive link below.
          </span>
        </Field>
        <LinkRows links={links} onChange={setLinks} />
        <Field label="Notes">
          <textarea name="notes" rows={2} className={inputCls} />
        </Field>
        <Field label="Do you need to schedule a meeting to discuss this task before we begin?">
          <select name="scheduleMeeting" className={inputCls} defaultValue="">
            <option value="">—</option>
            <option>No</option>
            <option>Yes</option>
          </select>
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          disabled={state === "sending"}
          className="rounded-lg bg-brand py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {state === "sending" ? "Sending…" : "Submit brief"}
        </button>
      </form>
    </div>
  );
}
