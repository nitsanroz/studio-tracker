"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MONTH_SHORT, type ClientMonthly } from "@/lib/finance/finance";
import { formatILS, formatShortDay, isoDate, studioDay } from "@/lib/finance/format";
import { DEFAULT_CLIENT_TERMS, termsAdjective } from "@/lib/payment-terms";
import { RECEIVABLE_TERMS_DAYS, receivables, type IncomeLike, type Receivable, type TermsByClient } from "@/lib/finance/receivables";
import { InvoicedMark } from "@/components/finance/ui";

/**
 * "Owed to the studio" on the Plan (Nitsan, 2026-10-31): the year's final,
 * unpaid income cells as one list — who, which month, how much with VAT, and
 * how late — so chasing money doesn't mean scanning the grid for cells that
 * aren't green-ticked. Folded to its one-line total until opened. Each line
 * can be marked Invoiced or Paid right here (`onStep` — the same write as the
 * cell's card), since this year's months start unmarked.
 */
export function ReceivablesCard({
  clientMonthly,
  income,
  terms,
  invoiced,
  busy,
  onStep,
}: {
  clientMonthly: ClientMonthly[];
  income: IncomeLike[];
  /** each client's payment terms + invoice day (`useClientTerms`) */
  terms: TermsByClient;
  /** reference/0013 is run: offer Invoiced */
  invoiced: boolean;
  busy: boolean;
  onStep: (r: Receivable, step: "invoiced" | "paid") => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useMemo(() => receivables(clientMonthly, income, isoDate(new Date()), terms), [clientMonthly, income, terms]);
  const other = [...new Set(list.filter((r) => r.termsLabel !== termsAdjective(DEFAULT_CLIENT_TERMS)).map((r) => `${r.name} ${r.termsLabel}`))];
  if (!list.length) return null;
  const total = list.reduce((t, r) => t + r.withVat, 0);
  const late = list.filter((r) => r.daysLate > 0);

  return (
    <section className="mb-3 rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2.5 text-left text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="font-medium text-foreground">Owed to the studio</span>
        <span className="tabular-nums text-foreground">{formatILS(Math.round(total))}</span>
        <span className="text-muted">
          incl. VAT · {list.length} {list.length === 1 ? "month" : "months"}
          {late.length > 0 && <span className="text-danger"> · {late.length} past due</span>}
        </span>
        <ChevronDown size={16} className={`ml-auto text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-faint">
              <tr>
                <th className="px-4 py-1.5 font-medium">Client / project</th>
                <th className="px-2 py-1.5 font-medium">Month</th>
                <th className="px-2 py-1.5 font-medium">Step</th>
                <th className="px-2 py-1.5 text-right font-medium">Before VAT</th>
                <th className="px-2 py-1.5 text-right font-medium">With VAT</th>
                <th className="px-2 py-1.5 text-right font-medium">Due</th>
                <th className="px-4 py-1.5">
                  <span className="sr-only">Mark</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.kind}|${r.name}|${r.year}|${r.month}`} className="border-t border-border/60">
                  <td className="bidi-auto px-4 py-1.5 text-foreground">{r.name}</td>
                  <td className="px-2 py-1.5 text-muted">
                    {MONTH_SHORT[r.month - 1]} {r.year}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                    {r.step === "invoiced" ? (
                      <>
                        <InvoicedMark />
                        Invoiced {formatShortDay(studioDay(r.invoicedAt!))}
                      </>
                    ) : (
                      "Final, not invoiced"
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{formatILS(r.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{formatILS(r.withVat)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 text-right ${r.daysLate > 0 ? "text-danger" : "text-muted"}`}>
                    {r.daysLate > 0 ? `${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} late` : `by ${formatShortDay(r.due)}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-1 text-right">
                    {invoiced && r.step === "final" && (
                      <button
                        disabled={busy}
                        onClick={() => onStep(r, "invoiced")}
                        className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                      >
                        Invoiced
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => onStep(r, "paid")}
                      className="rounded-md px-2 py-1 text-xs font-medium text-[var(--state-paid-fg)] hover:bg-[var(--state-paid-bg)] disabled:opacity-50"
                    >
                      Paid
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-2.5 pt-1.5 text-xs text-faint">
            Due {RECEIVABLE_TERMS_DAYS} days after the invoice{other.length > 0 && ` (${other.join(", ")})`} — counted from the client&apos;s invoice day while it isn&apos;t invoiced yet (a project from its month&apos;s end). Terms and invoice days are set in the tracker&apos;s Client Reports. Mark a line here, or from its cell&apos;s card on the grid.
          </p>
        </div>
      )}
    </section>
  );
}

