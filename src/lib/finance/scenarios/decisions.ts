// The decision catalogue: everything a scenario can change, each with the
// month it takes effect. Stored as JSON in finance_scenarios.decisions, so a
// saved scenario always re-runs on today's live baseline (never a frozen copy
// of the data). One flat shape — the page edits any decision from its fields
// list, and the advisor's "Try this" proposals come back in the same shape.

import { EN, monthIn, type Lang, type T } from "./i18n";
import type { Baseline, Currency, Member, Ym } from "./types";

export type DecisionType =
  | "office_end"
  | "office_move"
  | "person_leave"
  | "person_pay"
  | "person_hours"
  | "person_to_freelance"
  | "freelancer_add"
  | "freelancer_change"
  | "freelancer_remove"
  | "hire"
  | "rate_change"
  | "keys_target"
  | "ai_productivity"
  | "in_house"
  | "fixed_price"
  | "service_line"
  | "tools_cut"
  | "one_off"
  | "recurring"
  | "owner_hours"
  | "staff_hours"
  | "owner_salary"
  | "dividend"
  | "loan_repay"
  | "withdrawal";

/** One decision. Percentages are whole numbers (10 = 10%); money is ₪. */
export interface Decision {
  id: string;
  type: DecisionType;
  /** The month it takes effect ("YYYY-MM"). For "office_end" the month notice
   * is given; for "person_leave" the last month paid. */
  from: Ym;
  personId?: string;
  name?: string;
  label?: string;
  pct?: number;
  amount?: number;
  rate?: number;
  currency?: Currency;
  capacity?: number;
  hours?: number;
  /** Notice months (office), ramp-up months (AI, in-house, hire). */
  months?: number;
  paidWritedowns?: boolean;
  /** Office exit: other office costs that go too (₪/month), leasehold write-off, equipment sale, moving. */
  alsoSaves?: number;
  writeoff?: number;
  equipmentSale?: number;
  movingCost?: number;
  toolCost?: number;
  discount?: number;
}

export type FieldKind = "month" | "money" | "pct" | "hours" | "count" | "rate" | "currency" | "bool" | "text" | "member" | "freelancer" | "designer";

export interface Field {
  key: keyof Decision;
  label: string;
  kind: FieldKind;
  /** Slider range (money/pct/hours/count/rate). */
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export type Group = "Office" | "People" | "Freelancers" | "Pricing & AI" | "Costs" | "You";

export interface DecisionMeta {
  label: string;
  group: Group;
  /** One line for the menu. */
  blurb: string;
  fields: Field[];
  /** A caution shown on the card. */
  note?: string;
}

const FROM: Field = { key: "from", label: "From", kind: "month" };

export const CATALOGUE: Record<DecisionType, DecisionMeta> = {
  office_end: {
    label: "End the lease",
    group: "Office",
    blurb: "Give notice and work from home",
    fields: [
      { key: "from", label: "Notice given in", kind: "month" },
      { key: "months", label: "Notice months", kind: "count", min: 1, max: 12, step: 1 },
      { key: "alsoSaves", label: "Other office costs that go too", kind: "money", min: 0, max: 15_000, step: 100, hint: "Beyond the Rent line: upkeep, cleaning, coffee… Handoff ~₪1.1K; the accountant's ₪25K/month total implies more." },
      { key: "writeoff", label: "Leasehold write-off", kind: "money", min: 0, max: 100_000, step: 1_000, hint: "A one-off P&L cost the month you leave — no cash." },
      { key: "equipmentSale", label: "Equipment sold", kind: "money", min: 0, max: 60_000, step: 500, hint: "Cash in, invoiced. In the P&L it's the price less the equipment's book value (Company facts) — below book is a loss." },
      { key: "movingCost", label: "Moving cost", kind: "money", min: 0, max: 30_000, step: 500 },
    ],
    note: "Rent is paid through the notice months. Working from home: a quarter of home bills can be claimed — ask the accountant.",
  },
  office_move: {
    label: "Smaller space / coworking",
    group: "Office",
    blurb: "A cheaper place instead of the studio",
    fields: [FROM, { key: "amount", label: "New cost a month", kind: "money", min: 0, max: 30_000, step: 250 }],
  },
  person_leave: {
    label: "Let someone go",
    group: "People",
    blurb: "Their last paid month",
    fields: [{ key: "personId", label: "Who", kind: "member" }, { key: "from", label: "Last month paid", kind: "month" }],
    note: "Section 14 is signed and deposited, so no severance on top.",
  },
  person_pay: {
    label: "Change someone's pay",
    group: "People",
    blurb: "A raise or a cut",
    fields: [{ key: "personId", label: "Who", kind: "member" }, FROM, { key: "pct", label: "Change", kind: "pct", min: -50, max: 50, step: 1 }],
  },
  person_hours: {
    label: "Change someone's hours",
    group: "People",
    blurb: "Job share up or down — cost and capacity move together",
    fields: [{ key: "personId", label: "Who", kind: "designer" }, FROM, { key: "pct", label: "Change", kind: "pct", min: -80, max: 50, step: 5 }],
  },
  person_to_freelance: {
    label: "Move someone to freelance",
    group: "People",
    blurb: "Paid per hour instead of a salary",
    fields: [
      { key: "personId", label: "Who", kind: "designer" },
      { key: "from", label: "First freelance month", kind: "month" },
      { key: "rate", label: "Rate an hour", kind: "rate", min: 30, max: 400, step: 5 },
      { key: "currency", label: "Currency", kind: "currency" },
      { key: "capacity", label: "Hours a month available", kind: "hours", min: 0, max: 200, step: 5 },
      { key: "paidWritedowns", label: "Paid for hours written down to Keys", kind: "bool" },
    ],
    note: "Employer-employee risk: check with a lawyer or the accountant before converting staff.",
  },
  freelancer_add: {
    label: "Add a freelancer",
    group: "Freelancers",
    blurb: "Someone new — here or abroad",
    fields: [
      { key: "name", label: "Name", kind: "text" },
      FROM,
      { key: "rate", label: "Rate an hour", kind: "rate", min: 20, max: 400, step: 5 },
      { key: "currency", label: "Currency", kind: "currency" },
      { key: "capacity", label: "Hours a month available", kind: "hours", min: 0, max: 200, step: 5 },
      { key: "paidWritedowns", label: "Paid for hours written down to Keys", kind: "bool" },
    ],
  },
  freelancer_change: {
    label: "Change a freelancer's terms",
    group: "Freelancers",
    blurb: "A new rate or more/less availability",
    fields: [
      { key: "personId", label: "Who", kind: "freelancer" },
      FROM,
      { key: "rate", label: "New rate an hour (0 = keep)", kind: "rate", min: 0, max: 400, step: 5 },
      { key: "capacity", label: "Hours a month available", kind: "hours", min: 0, max: 250, step: 5 },
      { key: "paidWritedowns", label: "Paid for hours written down to Keys", kind: "bool" },
    ],
  },
  freelancer_remove: {
    label: "Stop working with a freelancer",
    group: "Freelancers",
    blurb: "From a month on",
    fields: [{ key: "personId", label: "Who", kind: "freelancer" }, { key: "from", label: "First month without", kind: "month" }],
  },
  hire: {
    label: "Hire",
    group: "People",
    blurb: "A new employee",
    fields: [
      { key: "name", label: "Role / name", kind: "text" },
      FROM,
      { key: "amount", label: "Employer cost a month", kind: "money", min: 5_000, max: 50_000, step: 500 },
      { key: "capacity", label: "Client hours a month", kind: "hours", min: 0, max: 180, step: 5 },
      { key: "months", label: "Months to ramp up", kind: "count", min: 0, max: 6, step: 1 },
    ],
  },
  rate_change: {
    label: "Change the hourly rate",
    group: "Pricing & AI",
    blurb: "Price up or down",
    fields: [FROM, { key: "pct", label: "Change", kind: "pct", min: -30, max: 30, step: 1 }],
  },
  keys_target: {
    label: "Write down less (Keys)",
    group: "Pricing & AI",
    blurb: "The share of client work written down",
    fields: [FROM, { key: "pct", label: "Written down", kind: "pct", min: 0, max: 30, step: 1 }],
  },
  ai_productivity: {
    label: "AI makes us faster",
    group: "Pricing & AI",
    blurb: "The same work in fewer hours",
    fields: [
      FROM,
      { key: "pct", label: "Faster by", kind: "pct", min: 0, max: 60, step: 5 },
      { key: "months", label: "Months to get there", kind: "count", min: 0, max: 12, step: 1 },
      { key: "toolCost", label: "AI tools a month", kind: "money", min: 0, max: 10_000, step: 100 },
    ],
    note: "Billing by the hour, faster work is LESS revenue. It turns into margin only with work sold per deliverable.",
  },
  in_house: {
    label: "Clients take routine work in-house",
    group: "Pricing & AI",
    blurb: "Less volume as clients use AI themselves",
    fields: [
      FROM,
      { key: "pct", label: "Volume lost", kind: "pct", min: 0, max: 60, step: 5 },
      { key: "months", label: "Over how many months", kind: "count", min: 0, max: 12, step: 1 },
    ],
  },
  fixed_price: {
    label: "Sell per deliverable",
    group: "Pricing & AI",
    blurb: "Fixed prices instead of hours",
    fields: [
      FROM,
      { key: "pct", label: "Share of work sold fixed-price", kind: "pct", min: 0, max: 100, step: 5 },
      { key: "discount", label: "Discount given for it", kind: "pct", min: 0, max: 40, step: 1 },
    ],
  },
  service_line: {
    label: "New service line",
    group: "Pricing & AI",
    blurb: "Extra work at its own rate",
    fields: [
      { key: "label", label: "What", kind: "text" },
      FROM,
      { key: "hours", label: "Hours a month", kind: "hours", min: 0, max: 200, step: 5 },
      { key: "rate", label: "₪ an hour", kind: "rate", min: 100, max: 800, step: 10 },
    ],
  },
  tools_cut: {
    label: "Cut tools & subscriptions",
    group: "Costs",
    blurb: "Less spend a month",
    fields: [FROM, { key: "amount", label: "Saved a month", kind: "money", min: 0, max: 10_000, step: 100 }],
  },
  one_off: {
    label: "One-off cost or income",
    group: "Costs",
    blurb: "A single month",
    fields: [
      { key: "label", label: "What", kind: "text" },
      { key: "from", label: "Month", kind: "month" },
      { key: "amount", label: "Amount (+ income, − cost)", kind: "money", min: -100_000, max: 100_000, step: 500 },
    ],
  },
  recurring: {
    label: "Recurring cost",
    group: "Costs",
    blurb: "A new cost every month (negative = saving)",
    fields: [{ key: "label", label: "What", kind: "text" }, FROM, { key: "amount", label: "₪ a month", kind: "money", min: -20_000, max: 20_000, step: 100 }],
  },
  owner_hours: {
    label: "Your client hours",
    group: "You",
    blurb: "How much you design for clients",
    fields: [FROM, { key: "hours", label: "Hours a month", kind: "hours", min: 0, max: 120, step: 5 }],
  },
  staff_hours: {
    label: "Michal's client hours",
    group: "You",
    blurb: "Client hours from the non-design staff",
    fields: [FROM, { key: "hours", label: "Hours a month", kind: "hours", min: 0, max: 120, step: 5 }],
  },
  owner_salary: {
    label: "Your salary",
    group: "You",
    blurb: "Gross a month — e.g. up to the bracket top",
    fields: [FROM, { key: "amount", label: "Gross a month", kind: "money", min: 0, max: 60_000, step: 500 }],
    note: "The accountant: salary beats dividend up to ~₪25K a month. Confirm the figure with him.",
  },
  dividend: {
    label: "Declare a dividend",
    group: "You",
    blurb: "Net to you; it clears the loan first",
    fields: [{ key: "from", label: "Tax paid in", kind: "month" }, { key: "amount", label: "Net dividend", kind: "money", min: 0, max: 400_000, step: 1_000 }],
    note: "A dividend on 2025's profits is paid by 19 January. Confirm with the accountant.",
  },
  loan_repay: {
    label: "Repay the shareholder loan",
    group: "You",
    blurb: "Money back into the company",
    fields: [{ key: "from", label: "Month", kind: "month" }, { key: "amount", label: "Amount", kind: "money", min: 0, max: 300_000, step: 1_000 }],
  },
  withdrawal: {
    label: "Withdrawals above salary",
    group: "You",
    blurb: "Taken a month — they add to the loan",
    fields: [FROM, { key: "amount", label: "₪ a month", kind: "money", min: 0, max: 30_000, step: 500 }],
  },
};

export const GROUPS: Group[] = ["Office", "People", "Freelancers", "Pricing & AI", "Costs", "You"];

export function addMonths(ym: Ym, n: number): Ym {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(a: Ym, b: Ym): number {
  return Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7)) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));
}

export const monthLabel = (ym: Ym, lang: Lang = "en") => monthIn(lang, ym);

let seq = 0;
export const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A new decision of a type, with sensible defaults from the baseline. */
export function newDecision(type: DecisionType, b: Baseline): Decision {
  const from = b.start;
  const d: Decision = { id: newId(), type, from };
  const designer = b.team.find((m) => m.kind === "designer");
  const freelancer = b.team.find((m) => m.kind === "freelancer");
  switch (type) {
    case "office_end":
      return { ...d, months: 4, alsoSaves: 1_100, writeoff: 0, equipmentSale: 0, movingCost: 0 };
    case "office_move":
      return { ...d, from: addMonths(from, 4), amount: Math.round(b.office / 2 / 250) * 250 };
    case "person_leave":
      return { ...d, personId: designer?.id, from: addMonths(from, 1) };
    case "person_pay":
      return { ...d, personId: designer?.id, pct: 5 };
    case "person_hours":
      return { ...d, personId: designer?.id, pct: -20 };
    case "person_to_freelance":
      return { ...d, personId: designer?.id, from: addMonths(from, 2), rate: 150, currency: "ILS", capacity: designer ? Math.round(designer.billable) : 100, paidWritedowns: false };
    case "freelancer_add":
      return { ...d, name: "New freelancer", rate: 40, currency: "EUR", capacity: 60, paidWritedowns: false };
    case "freelancer_change":
      return { ...d, personId: freelancer?.id, rate: 0, capacity: freelancer?.capacity ?? 60, paidWritedowns: freelancer?.paidWritedowns ?? true };
    case "freelancer_remove":
      return { ...d, personId: freelancer?.id, from: addMonths(from, 1) };
    case "hire":
      return { ...d, name: "Designer", from: addMonths(from, 2), amount: 15_000, capacity: 110, months: 2 };
    case "rate_change":
      return { ...d, pct: 5 };
    case "keys_target":
      return { ...d, pct: 5 };
    case "ai_productivity":
      return { ...d, pct: 20, months: 6, toolCost: 1_000 };
    case "in_house":
      return { ...d, pct: 15, months: 6 };
    case "fixed_price":
      return { ...d, pct: 30, discount: 5 };
    case "service_line":
      return { ...d, label: "AI animation packages", hours: 20, rate: Math.round(b.rate / 10) * 10 };
    case "tools_cut":
      return { ...d, amount: 500 };
    case "one_off":
      return { ...d, label: "One-off", amount: -5_000 };
    case "recurring":
      return { ...d, label: "New cost", amount: 1_000 };
    case "owner_hours":
      return { ...d, hours: b.ownerHours };
    case "staff_hours":
      return { ...d, hours: b.staffHours };
    case "owner_salary":
      return { ...d, from: "2027-01", amount: 25_000 };
    case "dividend":
      return { ...d, from: "2027-01", amount: 0 };
    case "loan_repay":
      return { ...d, from: addMonths(from, 1), amount: 50_000 };
    case "withdrawal":
      return { ...d, amount: 5_000 };
  }
}

/** One line saying what a decision does — the card's header and the timeline. */
export function describe(d: Decision, team: Member[], t: T = EN): string {
  const who = team.find((m) => m.id === d.personId)?.name ?? t("someone");
  const k = (n = 0) => `₪${Math.abs(n) >= 1000 ? `${Math.round(Math.abs(n) / 100) / 10}K` : Math.round(Math.abs(n))}`;
  const sign = (n = 0) => `${n >= 0 ? "+" : ""}${n}%`;
  const month = (ym: Ym) => monthIn(t.lang, ym);
  switch (d.type) {
    case "office_end":
      return t("Notice on the studio → last rent {month}", { month: month(addMonths(d.from, d.months ?? 4)) });
    case "office_move":
      return t("Move to a {amount}/month space", { amount: k(d.amount) });
    case "person_leave":
      return t("{who} leaves after {month}", { who, month: month(d.from) });
    case "person_pay":
      return t("{who}'s pay {pct}", { who, pct: sign(d.pct) });
    case "person_hours":
      return t("{who}'s hours {pct}", { who, pct: sign(d.pct) });
    case "person_to_freelance":
      return t("{who} → freelance at {rate} {currency}/h", { who, rate: d.rate ?? 0, currency: d.currency ?? "ILS" });
    case "freelancer_add":
      return t("{name} joins at {rate} {currency}/h, {hours}h/month", { name: d.name || t("A freelancer"), rate: d.rate ?? 0, currency: d.currency ?? "ILS", hours: d.capacity ?? 0 });
    case "freelancer_change":
      return d.rate ? t("{who}: {rate}/h, {hours}h/month", { who, rate: d.rate, hours: d.capacity ?? 0 }) : t("{who}: {hours}h/month", { who, hours: d.capacity ?? 0 });
    case "freelancer_remove":
      return t("Stop with {who}", { who });
    case "hire":
      return t("Hire {name} at {amount}/month", { name: d.name || t("someone"), amount: k(d.amount) });
    case "rate_change":
      return t("Rate {pct}", { pct: sign(d.pct) });
    case "keys_target":
      return t("Write down {pct}% to Keys", { pct: d.pct ?? 0 });
    case "ai_productivity":
      return t("AI: {pct}% faster", { pct: d.pct ?? 0 });
    case "in_house":
      return t("Clients take {pct}% in-house", { pct: d.pct ?? 0 });
    case "fixed_price":
      return t("{pct}% sold per deliverable", { pct: d.pct ?? 0 });
    case "service_line":
      return t("{label}: {hours}h at ₪{rate}", { label: d.label || t("New service"), hours: d.hours ?? 0, rate: d.rate ?? 0 });
    case "tools_cut":
      return t("Tools −{amount}/month", { amount: k(d.amount) });
    case "one_off":
      return `${d.label || t("One-off")} ${(d.amount ?? 0) >= 0 ? "+" : "−"}${k(d.amount)}`;
    case "recurring":
      return t("{label} {amount}/month", { label: d.label || t("Recurring"), amount: `${(d.amount ?? 0) >= 0 ? "" : "−"}${k(d.amount)}` });
    case "owner_hours":
      return t("You: {hours}h a month for clients", { hours: d.hours ?? 0 });
    case "staff_hours":
      return t("Michal: {hours}h a month for clients", { hours: d.hours ?? 0 });
    case "owner_salary":
      return t("Your salary {amount} gross", { amount: k(d.amount) });
    case "dividend":
      return t("Dividend {amount} net", { amount: k(d.amount) });
    case "loan_repay":
      return t("Repay {amount} of the loan", { amount: k(d.amount) });
    case "withdrawal":
      return t("Withdraw {amount}/month", { amount: k(d.amount) });
  }
}

const isYm = (v: unknown): v is Ym => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A decision from stored or Claude-proposed JSON — null when its type is
 * unknown or it names someone not on the team. Unknown keys are dropped. */
export function cleanDecision(raw: unknown, team: Member[]): Decision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as DecisionType;
  if (!(type in CATALOGUE) || !isYm(r.from)) return null;
  const meta = CATALOGUE[type];
  const d: Decision = { id: typeof r.id === "string" && r.id ? r.id : newId(), type, from: r.from };
  for (const f of meta.fields) {
    const v = r[f.key];
    if (f.key === "from") continue;
    if (f.kind === "member" || f.kind === "designer" || f.kind === "freelancer") {
      const m = team.find((t) => t.id === v);
      const ok = m && (f.kind === "member" ? m.kind !== "owner" : f.kind === "designer" ? m.kind === "designer" : m.kind === "freelancer");
      if (!ok) return null;
      d.personId = m.id;
    } else if (f.kind === "currency") {
      d.currency = v === "EUR" || v === "USD" ? v : "ILS";
    } else if (f.kind === "bool") {
      (d as unknown as Record<string, unknown>)[f.key] = v === true;
    } else if (f.kind === "text") {
      (d as unknown as Record<string, unknown>)[f.key] = typeof v === "string" ? v.slice(0, 80) : "";
    } else if (f.kind === "month") {
      if (isYm(v)) (d as unknown as Record<string, unknown>)[f.key] = v;
    } else {
      const n = num(v);
      if (n !== undefined) (d as unknown as Record<string, unknown>)[f.key] = n;
    }
  }
  return d;
}
