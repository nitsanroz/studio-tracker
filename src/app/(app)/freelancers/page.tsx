"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { useIsAdmin } from "@/lib/store";
import { TermsForm, act, hrs, money, monthLabel, otherLine, termsLine, type Freelancer } from "./shared";

// Every freelancer at a glance (0054–0056): this month's bill and what waits
// for review. Open one for his month, row by row — /freelancers/[profileId].

interface Data {
  period: string;
  freelancers: Freelancer[];
}

export default function FreelancersPage() {
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetch("/api/admin/freelancers", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as Data) : Promise.reject(new Error((await r.json()).error))))
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isAdmin, version]);

  if (!isAdmin) return <p className="py-20 text-center text-sm text-muted">Admins only.</p>;
  if (error) return <p className="py-20 text-center text-sm text-danger">{error}</p>;
  if (!data) return <p className="py-20 text-center text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="font-serif-accent text-[28px] leading-9">Freelancers</h1>
        <p className="text-sm text-muted">
          They log hours through a private link — no login, so they see only their own logs. Open one to review his
          month and file what&apos;s waiting on a task.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.freelancers.map((f) => (
          <Link
            key={f.profileId}
            href={`/freelancers/${f.profileId}`}
            className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-card hover:border-brand"
          >
            <div className="flex items-end justify-between gap-4 bg-brand px-5 py-4 text-white">
              <div className="min-w-0">
                <h2 className="font-serif-accent truncate text-[28px] leading-9">{f.name}</h2>
                <p className="text-xs text-white/75">{termsLine(f.terms)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-white/70">{monthLabel(data.period)}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {money(f.month.total, f.terms.currency)}
                  {otherLine(f.month.otherExtras)}
                </p>
                <p className="text-xs tabular-nums text-white/80">
                  {hrs(f.month.hours)} × {money(f.month.rate, f.terms.currency)}/h
                  {f.month.extras > 0 && ` + ${money(f.month.extras, f.terms.currency)} extras`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-5 py-3 text-sm">
              {f.pendingCount > 0 ? (
                <span className="flex items-center gap-1.5 font-medium text-warning">
                  <Clock size={15} /> {f.pendingCount} waiting for review
                </span>
              ) : (
                <span className="text-muted">Nothing waiting</span>
              )}
              {!f.active && <span className="text-xs text-danger">· link switched off</span>}
              <span className="ml-auto flex items-center gap-1 text-brand opacity-70 group-hover:opacity-100">
                Open <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <AddFreelancer onDone={() => setVersion((v) => v + 1)} />
    </div>
  );
}

function AddFreelancer({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted hover:border-brand hover:text-brand"
      >
        + Add a freelancer
      </button>
    );
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-base font-medium">Add a freelancer</h2>
      <p className="text-xs text-muted">
        They get a private link to log hours — no login, and they never appear among the studio&apos;s members.
      </p>
      <TermsForm
        initial={{ currency: "EUR", rateHigh: 50, rateLow: 50, hoursLow: 50, hoursHigh: 150 }}
        submitLabel="Add freelancer"
        onCancel={() => setOpen(false)}
        onSubmit={async (t) => {
          if (!name.trim()) return "Give the freelancer a name.";
          const err = await act({ action: "create", name, ...t });
          if (!err) {
            setOpen(false);
            setName("");
            onDone();
          }
          return err;
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </TermsForm>
    </section>
  );
}
