"use client";

// What each person costs and brings in, on the Team page's cards and table
// (Nitsan, 2026-11-15: "the People page isn't needed — its figures can go on
// the team's cards"). The same sums People showed (lib/finance/people.ts
// `summarize`): the year of the last finished month, finished months only.
//
// ⚠️ Full finance only: the Team page asks for it only for that tier, and the
// rows come back through the viewer's own session (RLS) — anyone else gets none.

import { useMemo } from "react";
import { usePeople } from "@/lib/finance/people-data";
import { finishedThrough, hoursAreOwnWork, summarize } from "@/lib/finance/people";
import { formatILS, formatNum } from "@/lib/finance/format";

export interface PersonMoney {
  cost: number;
  costPerHour: number | null;
  returnRatio: number | null;
}

export function useTeamMoney(enabled: boolean): { year: number; byId: Map<string, PersonMoney> } {
  const { data } = usePeople({ skip: !enabled });
  const upTo = finishedThrough();
  const year = Number(upTo.slice(0, 4));
  const byId = useMemo(() => {
    const out = new Map<string, PersonMoney>();
    if (!data) return out;
    for (const p of data.people) {
      const s = summarize(data.ledgers.get(p.id), year, upTo, hoursAreOwnWork(p.position));
      if (s.cost > 0) out.set(p.id, { cost: s.cost, costPerHour: s.costPerHour, returnRatio: s.returnRatio });
    }
    return out;
  }, [data, year, upTo]);
  return { year, byId };
}

const returnTone = (r: number | null) => (r == null ? "" : r < 1 ? "text-danger" : "");

/** A card's money row: cost, cost an hour, return — for the year named. */
export function MoneyLine({ m, year }: { m: PersonMoney | undefined; year: number }) {
  if (!m) return null;
  return (
    <div
      className="mt-2 flex items-center gap-4 border-t border-border pt-2 text-xs"
      title="Cost = salary or freelance pay, with the employer's share. Return = what their billable hours brought in ÷ the part of their cost that went to client work. Finished months only."
    >
      <span>
        <span className="font-medium tabular-nums">{formatILS(Math.round(m.cost))}</span>
        <span className="ml-1 text-muted">cost {year}</span>
      </span>
      {m.costPerHour != null && (
        <span>
          <span className="font-medium tabular-nums">₪{formatNum(m.costPerHour)}</span>
          <span className="ml-1 text-muted">/h</span>
        </span>
      )}
      {m.returnRatio != null && (
        <span>
          <span className={`font-medium tabular-nums ${returnTone(m.returnRatio)}`}>{m.returnRatio.toFixed(1)}×</span>
          <span className="ml-1 text-muted">return</span>
        </span>
      )}
    </div>
  );
}

/** Table cells: cost, cost an hour, return. */
export function MoneyCells({ m, width }: { m: PersonMoney | undefined; width: number }) {
  const cell = "shrink-0 text-right text-xs tabular-nums";
  return (
    <>
      <span className={cell} style={{ width }}>
        {m ? formatILS(Math.round(m.cost)) : <span className="text-faint">–</span>}
      </span>
      <span className={cell} style={{ width: 64 }}>
        {m?.costPerHour != null ? `₪${formatNum(m.costPerHour)}` : <span className="text-faint">–</span>}
      </span>
      <span className={`${cell} font-medium ${returnTone(m?.returnRatio ?? null)}`} style={{ width: 56 }}>
        {m?.returnRatio != null ? `${m.returnRatio.toFixed(1)}×` : <span className="text-faint">–</span>}
      </span>
    </>
  );
}
