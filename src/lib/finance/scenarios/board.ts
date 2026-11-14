// The decision board (pure): every decision the page offers, laid out as
// tick-boxes in foldable groups — the office, each person on the team, new
// people, pricing & AI, costs, and you (Nitsan, 2026-11-11: "check boxes of
// items under foldable groups … group of office, group of Nadav"). A ticked
// item IS a decision in the scenario; its fields are that decision's levers.

import { CATALOGUE, newDecision, type Decision, type DecisionType, type Field } from "./decisions";
import { EN, type T } from "./i18n";
import type { Baseline, Member } from "./types";

export interface BoardItem {
  /** Which decision this tick is: its type, and the person it's about. */
  key: string;
  type: DecisionType;
  personId?: string;
  title: string;
  /** What it does, in a few words. */
  blurb: string;
  /** The hover box: what it means and how the page counts it. */
  info: string;
  /** Can be ticked more than once (a second freelancer, another one-off). */
  multi?: boolean;
  fields: Field[];
}

export interface BoardGroup {
  id: string;
  title: string;
  /** A line under the title (a person's role, cost and hours). */
  subtitle?: string;
  info: string;
  items: BoardItem[];
}

const INFO: Record<DecisionType, string> = {
  office_end:
    "Give the 4 months' notice and work from home. Rent is paid through the notice; after it the Rent line and the other office costs you set stop. The leasehold improvements left are written off that month (a P&L cost, no cash). Selling equipment brings its price in cash; the P&L sees the price less its book value.",
  office_move: "A smaller place or a coworking desk instead of the studio, at the cost you set a month.",
  person_leave: "They're paid through the month you pick, then cost nothing — and their hours leave too, so work beyond the others' capacity goes to freelancers or is turned away. Section 14 is signed: no severance on top.",
  person_pay: "A raise or a cut, as a percentage of their employer cost.",
  person_hours: "A smaller or bigger job share: their cost and their hours move together.",
  person_to_freelance:
    "Their salary stops; from that month they're paid per hour at the rate you set, only for the hours there's work for. Check employer-employee risk with a lawyer first.",
  freelancer_add: "Someone new, paid per hour in their currency (converted at the bank's rate + 5%). They take work only when the team is full, cheapest first.",
  freelancer_change: "A new rate (0 keeps today's) or more/less hours a month available.",
  freelancer_remove: "No more work goes to them from that month.",
  hire: "A new employee: a fixed cost every month, ramping up to full hours over the months you set.",
  rate_change: "Every hourly client price up or down by this much.",
  keys_target:
    "The share of client work written down to a client's Keys task — done but never billed. It still takes people's time. Today it's the share shown in Today's studio.",
  ai_productivity:
    "The same work done in fewer hours. Billing by the hour, that is LESS revenue for the same work — it becomes margin only on work sold per deliverable. Add the AI tools' cost.",
  in_house: "Clients do part of the routine work themselves with AI: this much less work comes in, reached over the months you set.",
  fixed_price:
    "Part of the work sold at a price per deliverable instead of per hour. That part earns the same however fast it's done (less the discount you give), so AI speed becomes margin.",
  service_line: "A new kind of work (e.g. AI animation packages) at its own hours and price.",
  tools_cut: "Subscriptions and tools cancelled — saved every month from the month you pick.",
  one_off: "A single cost (negative) or income (positive) in one month.",
  recurring: "A new cost every month (negative = a saving).",
  owner_hours: "How many hours a month you design for clients yourself. They cost nothing extra — your salary is paid anyway — so they're the first hours filled.",
  staff_hours: "Client hours a month from the non-design staff. Like yours, they're filled first.",
  owner_salary:
    "Your gross salary a month. The accountant: salary is cheaper than dividend up to ~₪25K a month (the 35% bracket), and you're pension-insured on ₪15K only. Employer cost moves with it.",
  dividend:
    "A dividend, net to you. It clears the shareholder loan first; only the tax (30%) leaves the bank. On 2025's profits it is paid by 19 January. Confirm with the accountant.",
  loan_repay: "Money you put back into the company against the shareholder loan.",
  withdrawal: "Money taken above salary each month. It adds to the shareholder loan (≈6% a year), and leaves the bank.",
};

const itemIn = (t: T) => (type: DecisionType, title: string, extra: Partial<BoardItem> = {}): BoardItem => ({
  key: extra.personId ? `${type}:${extra.personId}` : type,
  type,
  title: t(title),
  blurb: t(CATALOGUE[type].blurb),
  info: t(INFO[type]),
  fields: CATALOGUE[type].fields.filter((f) => f.kind !== "member" && f.kind !== "designer" && f.kind !== "freelancer"),
  ...extra,
});

const ROLE: Record<Member["kind"], string> = { designer: "Designer", staff: "Staff", owner: "Owner", freelancer: "Freelancer" };
export const roleOf = (kind: Member["kind"], t: T = EN) => t(ROLE[kind]);
const k = (n: number) => `₪${n >= 1000 ? `${Math.round(n / 100) / 10}K` : Math.round(n)}`;

function subtitle(m: Member, t: T): string {
  const hours = t("{hours}h billed a month", { hours: Math.round(m.billable) });
  if (m.price) {
    const rate = m.price.kind === "flat" ? `₪${Math.round(m.price.rate)}/h` : `₪${Math.round(m.price.terms.rateHigh)}→${Math.round(m.price.terms.rateLow)}/h`;
    return `${roleOf(m.kind, t)} · ${rate} · ${hours}`;
  }
  return `${roleOf(m.kind, t)} · ${t("{amount} a month", { amount: k(m.monthlyCost) })} · ${hours}`;
}

export function boardFor(b: Baseline, t: T = EN): BoardGroup[] {
  const item = itemIn(t);
  const groups: BoardGroup[] = [
    {
      id: "office",
      title: t("Office"),
      subtitle: t("Rent line {amount} a month", { amount: k(b.office) }),
      info: t("The studio space. With 2–3 designers in the office it isn't worth it (your words); the accountant puts the whole place at ~₪25K a month."),
      items: [item("office_end", "End the lease"), item("office_move", "Move to a smaller space or coworking")],
    },
  ];
  for (const m of b.team) {
    if (m.kind === "owner") continue;
    const p = { personId: m.id };
    const items =
      m.kind === "freelancer"
        ? [item("freelancer_change", "Change terms", p), item("freelancer_remove", "Stop working together", p)]
        : m.kind === "staff"
          ? [item("staff_hours", "Client hours a month"), item("person_pay", "Change pay", p), item("person_hours", "Change job share", p), item("person_leave", "Let go", p)]
          : [item("person_leave", "Let go", p), item("person_to_freelance", "Move to freelance", p), item("person_pay", "Change pay", p), item("person_hours", "Change job share", p)];
    groups.push({
      id: `person:${m.id}`,
      title: m.name,
      subtitle: subtitle(m, t),
      info:
        m.kind === "freelancer"
          ? t("A freelancer: paid only for the hours there's work for, and takes as much as the work needs (at least a full month) — fewer people on salary means more freelance hours.")
          : m.capacity
            ? t("Averages over the last {n} finished months. They can take {hours}h of client work a month (90% of the hours they log).", { n: b.basedOn.length, hours: m.capacity })
            : t("Averages over the last {n} finished months. Their client hours are set with the client-hours lever.", { n: b.basedOn.length }),
      items,
    });
  }
  groups.push(
    {
      id: "new",
      title: t("New people"),
      info: t("Freelancers or employees who aren't on the team today. Tick again to add another."),
      items: [item("freelancer_add", "Add a freelancer", { multi: true }), item("hire", "Hire an employee", { multi: true })],
    },
    {
      id: "pricing",
      title: t("Pricing & AI"),
      info: t("How the studio sells and how fast it works — where the AI shift hits hardest."),
      items: [
        item("fixed_price", "Sell per deliverable"),
        item("ai_productivity", "AI makes us faster"),
        item("in_house", "Clients take routine work in-house"),
        item("rate_change", "Change the hourly rate"),
        item("keys_target", "Write down less (Keys)"),
        item("service_line", "New service line", { multi: true }),
      ],
    },
    {
      id: "costs",
      title: t("Costs"),
      info: t("Everything else the studio spends."),
      items: [item("tools_cut", "Cut tools & subscriptions"), item("recurring", "A recurring cost or saving", { multi: true }), item("one_off", "A one-off cost or income", { multi: true })],
    },
    {
      id: "you",
      title: t("You"),
      subtitle: b.ownerGross ? t("Salary {amount} gross", { amount: `₪${Math.round(b.ownerGross).toLocaleString("en-US")}` }) : undefined,
      info: t("Your own decisions: your time, your pay, and the shareholder loan. Cash moves (dividend, loan, withdrawals) don't change profit — they change the bank."),
      items: [item("owner_hours", "Your client hours a month"), item("owner_salary", "Your salary"), item("dividend", "Declare a dividend"), item("loan_repay", "Repay the shareholder loan"), item("withdrawal", "Withdrawals above salary")],
    },
  );
  return groups;
}

/** The board item a decision ticks. */
export const keyOf = (d: Decision) => (d.personId && d.type !== "staff_hours" ? `${d.type}:${d.personId}` : d.type);

/** The group a decision belongs to. */
export function groupIdOf(d: Decision, board: BoardGroup[]): string | null {
  const key = keyOf(d);
  return board.find((g) => g.items.some((i) => i.key === key))?.id ?? null;
}

/** A fresh decision for a tick, with the baseline's defaults. */
export function decisionFor(it: BoardItem, b: Baseline): Decision {
  const d = newDecision(it.type, b);
  if (it.personId) {
    d.personId = it.personId;
    const m = b.team.find((x) => x.id === it.personId);
    if (m && it.type === "person_to_freelance") d.capacity = Math.round(m.billable + m.keys) || d.capacity;
    if (m && it.type === "freelancer_change") {
      d.capacity = m.capacity;
      d.paidWritedowns = m.paidWritedowns ?? true;
    }
  }
  return d;
}
