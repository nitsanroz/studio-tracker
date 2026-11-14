// Default futures and the one-click starter scenarios — the ones worked out by
// hand in the staffing chat (handoff, 2026-11-10) and the accountant's call
// (2026-11-11). Starters are suggestions, not saved until the owner saves.

import { addMonths, monthsBetween, newId, type Decision } from "./decisions";
import { DIVIDEND_DUE } from "./facts-shared";
import { EN, type T } from "./i18n";
import type { Baseline, CompanyFacts, Futures, Member } from "./types";

const round5 = (n: number) => Math.round(n / 5) * 5;

/** What the owner sets about demand: the middle, and how far either side the
 * bad and good futures go (Nitsan, 2026-11-11: "just middle with a parameter
 * of how wide bad and good go"). No project income — non-hourly work is rare. */
export interface Demand {
  hours: number;
  /** 0.25 = bad is 25% under the middle, good 25% over. */
  spread: number;
}

export const defaultDemand = (b: Baseline): Demand => ({ hours: round5(b.soldHours), spread: 0.25 });

export function futuresFrom(d: Demand): Futures {
  const f = (hours: number) => ({ hours: Math.max(0, hours), drift: 0, projectIncome: 0 });
  return { bad: f(d.hours * (1 - d.spread)), mid: f(d.hours), good: f(d.hours * (1 + d.spread)) };
}

/** Stored demand, or null when it isn't one. */
export function demandFrom(v: unknown): Demand | null {
  const d = v as Partial<Demand> | null;
  return d && typeof d.hours === "number" && typeof d.spread === "number" ? { hours: d.hours, spread: d.spread } : null;
}

const byName = (team: Member[], ...names: string[]) =>
  team.find((m) => names.some((n) => m.name.toLowerCase().split(/\s+/).includes(n)));

export interface Starter {
  name: string;
  why: string;
  decisions: Decision[];
}

export function starters(b: Baseline, facts: CompanyFacts, t: T = EN): Starter[] {
  const s = b.start;
  const officeEnd: Decision = { id: newId(), type: "office_end", from: s, months: 4, alsoSaves: 1_100, writeoff: facts.leaseholdLeft, equipmentSale: 0, movingCost: 0 };
  const nadav = byName(b.team, "nadav");
  const aki = byName(b.team, "aki");
  const milica = byName(b.team, "milica", "melissa");
  const leave = (m: Member | undefined): Decision[] => (m ? [{ id: newId(), type: "person_leave", personId: m.id, from: addMonths(s, 1) }] : []);
  // Katie may already be a tracker freelancer (Ekaterina) — give her the hours, don't add her twice.
  const katieNow = byName(b.team, "katie", "ekaterina");
  const katie: Decision = katieNow
    ? { id: newId(), type: "freelancer_change", personId: katieNow.id, from: addMonths(s, 2), rate: 0, capacity: Math.round(katieNow.capacity + 115), paidWritedowns: false }
    : { id: newId(), type: "freelancer_add", from: addMonths(s, 2), name: "Katie", rate: 50, currency: "EUR", capacity: 115, paidWritedowns: false };
  const moreMilica: Decision[] = milica
    ? [{ id: newId(), type: "freelancer_change", personId: milica.id, from: addMonths(s, 2), rate: 0, capacity: Math.round(milica.capacity + 92), paidWritedowns: false }]
    : [{ id: newId(), type: "freelancer_add", from: addMonths(s, 2), name: "Melissa", rate: 35, currency: "USD", capacity: 92, paidWritedowns: false }];
  const months = Math.max(0, monthsBetween(facts.loanAsOf.slice(0, 7), DIVIDEND_DUE));
  const loanThen = Math.round((facts.loan * (1 + (facts.loanInterest * months) / 12)) / 1000) * 1000;
  return [
    { name: t("No office"), why: t("Notice this month; everyone works from home. Rent is paid through the notice."), decisions: [{ ...officeEnd }] },
    {
      name: t("Aki + Katie + Dima, no office"),
      why: t("Nadav's work goes to Katie (freelance, same quality). Aki and Dima stay."),
      decisions: [{ ...officeEnd, id: newId() }, ...leave(nadav), { ...katie }],
    },
    {
      name: t("All freelancers, no office"),
      why: t("Nadav → Katie, Aki → Melissa. Every designer hour is variable cost."),
      decisions: [{ ...officeEnd, id: newId() }, ...leave(nadav), ...leave(aki), { ...katie, id: newId() }, ...moreMilica],
    },
    {
      name: t("Salary 25K + close the loan"),
      why: t("The accountant's advice: salary up to the bracket top from January, and a dividend that clears the shareholder loan (tax by 19 Jan)."),
      decisions: [
        { id: newId(), type: "owner_salary", from: "2027-01", amount: facts.bracketTop },
        { id: newId(), type: "dividend", from: DIVIDEND_DUE, amount: loanThen },
      ],
    },
  ];
}
