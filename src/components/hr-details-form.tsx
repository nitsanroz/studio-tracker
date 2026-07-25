"use client";

import { useEffect, useState } from "react";

/**
 * The member's own HR details — shown as a welcome step on first sign-in and
 * editable later from Settings. Reads/writes /api/me/hr, which whitelists
 * columns server-side (salary is never exposed here).
 */

type Details = Record<string, string>;

const GROUPS: { title: string; fields: { key: string; label: string; type?: string }[] }[] = [
  {
    title: "About you",
    fields: [
      { key: "national_id", label: "ID number" },
      { key: "birth_date", label: "Date of birth", type: "date" },
      { key: "gender", label: "Gender" },
      { key: "marital_status", label: "Marital status" },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "personal_email", label: "Personal email", type: "email" },
      { key: "phone", label: "Phone", type: "tel" },
    ],
  },
  {
    title: "Address",
    fields: [
      { key: "street", label: "Street" },
      { key: "house_no", label: "House no." },
      { key: "floor", label: "Floor" },
      { key: "apartment", label: "Apartment" },
      { key: "city", label: "City" },
      { key: "zip", label: "ZIP" },
    ],
  },
  {
    title: "In case of emergency",
    fields: [
      { key: "emergency_contact_name", label: "Contact name" },
      { key: "emergency_contact_phone", label: "Contact phone" },
    ],
  },
];

export function HrDetailsForm({
  onSaved,
  confirmMode = false,
}: {
  onSaved?: () => void;
  /** welcome step: the save button also marks the details as confirmed */
  confirmMode?: boolean;
}) {
  const [values, setValues] = useState<Details>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/hr")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) {
          setError(j.error ?? "Could not load your details.");
          setLoading(false);
          return;
        }
        const d = j.details ?? {};
        const next: Details = {};
        for (const g of GROUPS) for (const f of g.fields) next[f.key] = d[f.key] ?? "";
        setValues(next);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load your details.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    setError(null);
    const res = await fetch("/api/me/hr", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmMode ? { ...values, confirm: true } : values),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Could not save your details.");
      return;
    }
    setStatus("Saved ✓");
    onSaved?.();
  }

  if (loading) return <p className="py-6 text-center text-sm text-faint">Loading your details…</p>;

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{g.title}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs font-medium text-muted">
                {f.label}
                <input
                  type={f.type ?? "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="bidi-auto rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-brand"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Saving…" : confirmMode ? "Confirm my details" : "Save changes"}
        </button>
        {status && <span className="text-sm text-success">{status}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
      <p className="text-xs text-faint">
        Only you and the studio admins can see these details. They are used for HR and payroll
        paperwork.
      </p>
    </div>
  );
}
