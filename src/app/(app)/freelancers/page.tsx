"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Clock, Link as LinkIcon, Plus } from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { Button } from "@/components/primitives";
import { useIsAdmin } from "@/lib/store";
import { TermsForm, act, hrs, money, monthLabel, otherLine, termsLine, type Freelancer } from "./shared";
import { PageSkeleton } from "@/components/skeleton";

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
  const [adding, setAdding] = useState(false);

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
  if (!data) return <PageSkeleton side={false} />;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Freelancers</h1>
          <p className="mt-1 text-sm text-muted">
            They log hours through a private link, with no login. Open one to review the month and file what&apos;s waiting.
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5">
            <Plus size={16} strokeWidth={2} /> Add a freelancer
          </Button>
        )}
      </div>

      {adding && (
        <AddFreelancer
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setVersion((v) => v + 1);
          }}
        />
      )}

      {/* The same card as the rest of the app (2026-10-23): the bill is the one
          figure that matters, in brand blue; the name is a person's, so serif. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[repeat(auto-fill,475px)]">
        {data.freelancers.map((f) => (
          <Link
            key={f.profileId}
            href={`/freelancers/${f.profileId}`}
            className="group flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-serif-accent truncate text-[28px] leading-9">{f.name}</h2>
                <p className="text-[13px] text-muted">{termsLine(f.terms)}</p>
              </div>
              {/* The website's arrow (studio-arrow.tsx), as big as the title
                  block allows (Nitsan, 2026-10-23) — the sign the whole card
                  opens. Its stroke scales with it: a thin line on a big
                  arrow read as a weaker icon. */}
              <StudioArrow
                size={48}
                up
                className="-mr-2 -mt-2 text-faint transition group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-brand"
              />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{monthLabel(data.period)}</p>
              <p className="font-serif-accent text-[44px] leading-none tabular-nums text-brand">
                {money(f.month.total, f.terms.currency)}
                {otherLine(f.month.otherExtras)}
              </p>
              <p className="mt-1.5 text-[13px] tabular-nums text-muted">
                {hrs(f.month.hours)} × {money(f.month.rate, f.terms.currency)}/h
                {f.month.extras > 0 && ` + ${money(f.month.extras, f.terms.currency)} extras`}
              </p>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2 text-[13px]">
              {f.pendingCount > 0 ? (
                <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 font-medium text-[#855800]">
                  <Clock size={14} /> {f.pendingCount} waiting for review
                </span>
              ) : (
                <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-medium text-success">
                  <Check size={14} /> Nothing waiting
                </span>
              )}
              {!f.active && (
                <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 font-medium text-danger">
                  <LinkIcon size={14} /> Link switched off
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function AddFreelancer({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <h2 className="text-base font-medium">Add a freelancer</h2>
      <p className="text-xs text-muted">
        They get a private link to log hours — no login, and they never appear among the studio&apos;s members.
      </p>
      <TermsForm
        initial={{ currency: "EUR", rateHigh: 50, rateLow: 50, hoursLow: 50, hoursHigh: 150 }}
        submitLabel="Add freelancer"
        onCancel={onClose}
        onSubmit={async (t) => {
          if (!name.trim()) return "Give the freelancer a name.";
          const err = await act({ action: "create", name, ...t });
          if (!err) {
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
