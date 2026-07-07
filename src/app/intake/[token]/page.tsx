"use client";

import { use, useEffect, useState } from "react";

const inputCls =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand bidi-auto";
const labelCls = "flex flex-col gap-1 text-sm font-medium";

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

export default function IntakeFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "form" | "invalid" | "sending" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/intake/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        setClientName(j.clientName);
        setState("form");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const body = new FormData(e.currentTarget);
    const res = await fetch(`/api/intake/${token}`, { method: "POST", body });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong — please try again.");
      setState("form");
      return;
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
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input name="name" required className={inputCls} />
          </Field>
          <Field label="Email" required>
            <input name="email" type="email" required className={inputCls} />
          </Field>
        </div>
        <Field label="Company" required>
          <input name="company" required className={inputCls} defaultValue={clientName ?? ""} />
        </Field>
        <Field label="Task Name" required>
          <input name="taskName" required className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dimensions / Technical Specifications" required>
            <input name="dimensions" required className={inputCls} placeholder="e.g. 1920×1080, A4 print…" />
          </Field>
          <Field label="Format" required>
            <input name="format" required className={inputCls} placeholder="e.g. PNG, Figma, PDF…" />
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
          <Field label="Due Date" required>
            <input name="dueDate" type="date" required className={inputCls} />
          </Field>
        </div>
        <Field label="Budget Range (hours)">
          <input name="budgetRange" className={inputCls} placeholder="e.g. 5-8" />
        </Field>
        <Field label="Creative Brief" required>
          <textarea name="creativeBrief" required rows={4} className={inputCls} />
        </Field>
        <Field label="What's the goal of this deliverable?" required>
          <textarea name="goal" required rows={2} className={inputCls} />
        </Field>
        <Field label="Where would it be displayed?" required>
          <textarea name="displayedWhere" required rows={2} className={inputCls} />
        </Field>
        <Field label="What's the target audience?" required>
          <textarea name="targetAudience" required rows={2} className={inputCls} />
        </Field>
        <Field label="Things to avoid?">
          <textarea name="thingsToAvoid" rows={2} className={inputCls} />
        </Field>
        <Field label="Content">
          <textarea name="content" rows={3} className={inputCls} placeholder="Copy, texts, links to assets…" />
        </Field>
        <Field label="Any files you need to add?">
          <input name="files" type="file" multiple className="text-sm" />
          <span className="text-xs text-faint">Up to 5 files, 10MB each — for larger files add a WeTransfer link in Notes.</span>
        </Field>
        <Field label="Notes" required>
          <textarea name="notes" required rows={2} className={inputCls} />
        </Field>
        <Field label="Do you need to schedule a meeting to discuss this task before we begin?" required>
          <select name="scheduleMeeting" required className={inputCls} defaultValue="">
            <option value="" disabled>Choose…</option>
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
