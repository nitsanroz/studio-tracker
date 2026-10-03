import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";

// The client's copy of an approved estimate — public, token-gated, FROZEN.
//
// ⚠️ IT RENDERS `published_snapshot` AND NOTHING ELSE, the same rule as the
// client reports (`report/[token]`): what the client sees is exactly what was
// approved and published, never the live estimate an admin may be editing in a
// newer version. The snapshot holds no internal notes, no discount reason and
// no change log — `publishEstimate` leaves them out on purpose.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Estimate — Studio&more", robots: { index: false } };

function admin() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const Para = ({ text, className = "" }: { text: string | null; className?: string }) =>
  text ? <div className={`bidi-auto whitespace-pre-wrap leading-relaxed ${className}`}>{text}</div> : null;

export default async function PublicEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const { data } = await admin()
    .from("lead_estimates")
    .select("published_snapshot")
    .eq("share_token", token)
    .maybeSingle();
  const s = (data as { published_snapshot?: PublishedEstimate | null } | null)?.published_snapshot;
  if (!s) notFound();

  const nis = (r: { min: number; max: number }) => fmtNis({ min: r.min * s.rate, max: r.max * s.rate });

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl px-5 py-10 text-[15px] text-foreground print:py-0">
      <div className="flex items-center justify-between">
        <span className="brand-wordmark w-28 bg-brand" aria-label="Studio&more" />
        <span className="text-[12px] text-faint">Estimate v{s.version}</span>
      </div>
      <h1 className="mt-8 font-serif-accent text-[34px] leading-tight">
        {s.company}
        {" × Studio&more"}
      </h1>
      <p className="mt-1 text-[14px] text-muted">Estimated scope, pricing &amp; timeline</p>

      <Para text={s.intro} className="mt-8" />

      {s.phases.map((p, i) => {
        // Lines sharing an option group are printed together under "choose one".
        const seen = new Set<string>();
        return (
          <section key={i} className="mt-10 break-inside-avoid-page">
            <h2 className="border-b border-border pb-2 text-[16px] font-semibold uppercase tracking-wide">
              {p.name}
            </h2>
            <Para text={p.description} className="mt-2 text-muted" />
            <ol className="mt-3 flex flex-col gap-4">
              {p.lines.map((l, j) => {
                if (l.altGroup) {
                  if (seen.has(l.altGroup)) return null;
                  seen.add(l.altGroup);
                  const options = p.lines.filter((x) => x.altGroup === l.altGroup);
                  return (
                    <li key={j}>
                      <div className="font-medium">
                        {l.altGroup} <span className="font-normal text-muted">(choose one)</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-4">
                        {options.map((o, k) => (
                          <div key={k}>
                            <div>
                              <span className="font-medium">Option {k + 1}: {o.name}</span>
                              {o.chosen && options.length > 1 && <span className="ml-1 text-[13px] text-brand">· Recommended</span>}
                              <span className="text-muted">
                                {" "}
                                — {fmtHours(o.hours)} | {nis(o.hours)}
                              </span>
                            </div>
                            <Para text={o.description} className="mt-0.5 text-[14px] text-muted" />
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={j}>
                    <div>
                      <span className="font-medium">{l.name}</span>
                      {l.optional && <span className="ml-1 text-[13px] text-muted">(optional)</span>}
                      <span className="text-muted">
                        {" "}
                        — {fmtHours(l.hours)} | {nis(l.hours)}
                      </span>
                    </div>
                    <Para text={l.description} className="mt-0.5 text-[14px] text-muted" />
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 font-medium">
              {p.name} total: {fmtHours(p.hours)} | {nis(p.hours)} + VAT
            </p>
          </section>
        );
      })}

      <section className="mt-10 rounded-xl border border-border bg-surface p-5 break-inside-avoid-page">
        {(s.discountPercent ?? 0) > 0 && (
          <div className="mb-2 flex justify-between text-[14px] text-muted">
            <span>Before discount</span>
            <span>{fmtNis(s.subtotal)}</span>
          </div>
        )}
        {(s.discountPercent ?? 0) > 0 && (
          <div className="mb-2 flex justify-between text-[14px] text-muted">
            <span>Discount {s.discountPercent}%</span>
            <span>−{fmtNis(s.discount)}</span>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-[17px] font-semibold">
          <span>Total estimate</span>
          <span>
            {fmtHours(s.totalHours)} | {fmtNis(s.net)} + VAT
          </span>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          We work on an hourly basis ({s.rate} NIS + VAT per hour). Optional items and options not chosen are not
          included in the total.
        </p>
      </section>

      {s.timeline && (
        <section className="mt-10 break-inside-avoid-page">
          <h2 className="border-b border-border pb-2 text-[16px] font-semibold uppercase tracking-wide">Timeline</h2>
          <Para text={s.timeline} className="mt-3" />
        </section>
      )}

      <Para text={s.closing} className="mt-10" />

      <p className="mt-12 text-[12px] text-faint print:hidden">
        {`Published ${new Date(s.publishedAt).toLocaleDateString("en-GB")} · Use your browser’s Print to save as PDF.`}
      </p>
    </main>
  );
}
