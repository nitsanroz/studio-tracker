// What the Scenarios advisor (Claude) is told, and what it may answer (pure).
//
// ⚠️ UNLIKE &advice, THIS SENDS REAL ₪ FIGURES — Nitsan's choice for this
// owner-only page (2026-11-11). People go by initials and a ref ("P3"),
// never by name or id. Never put the owner's personal (non-company) income
// in here.

import { CATALOGUE, cleanDecision, describe, type Decision, type DecisionType } from "./decisions";
import { initialsOf, type ScenarioResult } from "./engine";
import { ARRANGEMENTS_LAW } from "./facts-shared";
import { FUTURE_IDS, type Baseline, type CompanyFacts, type Futures, type Member } from "./types";

export type AdviceKind = "advise" | "compare" | "suggest";

export const ADVISE_SYSTEM = `You are a sharp, practical business advisor to the owner of Studio&more, a small Tel Aviv design and animation studio (branding, design, motion for clients, many of them abroad). You are looking at his own what-if scenarios on a private page.

The situation (late 2026):
- AI is changing the work. Clients now do part of the routine work themselves; simple technical work needs fewer hands; projects get smaller and shorter, with less ongoing (retainer) work. Nobody knows how much work will come in. Do NOT extrapolate the past — plan for a range and protect the bad case first.
- The studio bills mostly by the hour. Billing by the hour, AI speed is LESS revenue; selling per deliverable turns it into margin. Push the pricing question when it matters.
- Prefer variable cost and optionality (freelancers, no long commitments) while demand is unclear, but say when employees beat freelancers (enough steady hours, quality, availability).
- Base nothing on earlier years' salaries, workload or mix — the owner's words: what was won't be. Only today's studio (the last 3 months) and the present company facts count.
- Hours written down to a client's "Keys" task are work done but never billed.
- The owner and the other staff member supply a few client hours themselves.
- Company money: the owner owes the company a shareholder loan (≈6% a year). It is closed by repaying it, or by a dividend (30% dividend tax on top of 23% company tax). The accountant advises a salary up to about ₪25K a month (salary beats dividend up to the 35% bracket), then dividends. Retained earnings above ₪750K trigger the Arrangements Law (forced distribution).
- Two employees signed section 14 (no severance on top). Converting an employee to freelance carries employer-employee risk — always say "check with a lawyer".
- Tax and labour-law points: flag them as "confirm with the accountant / lawyer"; never decide them.

How to answer:
- Bottom line first, short and plain, in the language the request asks for (English or Hebrew). The owner reads on his phone.
- Use the figures given; don't invent data. Where a number is an estimate, say so.
- Score each recommendation 1–10 (how strongly you recommend it), with its ₪ effect a month (0 if not a money effect), its risk, and when to do it.
- Give triggers: what to watch, the level, and the move it should trigger.
- List the questions to ask people (freelancers, staff, clients) and the points to check with the accountant or a lawyer.
- "tryThis": up to 3 scenarios worth running, each as decisions from the catalogue given (use the person refs exactly; "" when a field doesn't apply, 0 for numbers that don't apply). Months are "YYYY-MM".`;

const DECISION_TYPES = Object.keys(CATALOGUE) as DecisionType[];

const decisionSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: DECISION_TYPES },
    from: { type: "string" },
    personRef: { type: "string" },
    name: { type: "string" },
    label: { type: "string" },
    pct: { type: "number" },
    amount: { type: "number" },
    rate: { type: "number" },
    currency: { type: "string", enum: ["ILS", "EUR", "USD"] },
    capacity: { type: "number" },
    hours: { type: "number" },
    months: { type: "number" },
    paidWritedowns: { type: "boolean" },
    discount: { type: "number" },
    alsoSaves: { type: "number" },
    writeoff: { type: "number" },
    equipmentSale: { type: "number" },
    movingCost: { type: "number" },
    toolCost: { type: "number" },
  },
  required: ["type", "from", "personRef", "name", "label", "pct", "amount", "rate", "currency", "capacity", "hours", "months", "paidWritedowns", "discount", "alsoSaves", "writeoff", "equipmentSale", "movingCost", "toolCost"],
  additionalProperties: false,
} as const;

export const ADVISE_SCHEMA = {
  type: "object",
  properties: {
    bottomLine: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          score: { type: "integer" },
          perMonth: { type: "number" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          when: { type: "string" },
        },
        required: ["title", "why", "score", "perMonth", "risk", "when"],
        additionalProperties: false,
      },
    },
    triggers: {
      type: "array",
      items: {
        type: "object",
        properties: { watch: { type: "string" }, level: { type: "string" }, then: { type: "string" } },
        required: ["watch", "level", "then"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: { type: "string" } },
    checkWith: {
      type: "array",
      items: {
        type: "object",
        properties: { who: { type: "string", enum: ["accountant", "lawyer"] }, what: { type: "string" } },
        required: ["who", "what"],
        additionalProperties: false,
      },
    },
    tryThis: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, why: { type: "string" }, decisions: { type: "array", items: decisionSchema } },
        required: ["name", "why", "decisions"],
        additionalProperties: false,
      },
    },
  },
  required: ["bottomLine", "recommendations", "triggers", "questions", "checkWith", "tryThis"],
  additionalProperties: false,
} as const;

export interface RawDecision {
  type: string;
  from: string;
  personRef: string;
  [k: string]: unknown;
}

export interface Advice {
  bottomLine: string;
  recommendations: { title: string; why: string; score: number; perMonth: number; risk: "low" | "medium" | "high"; when: string }[];
  triggers: { watch: string; level: string; then: string }[];
  questions: string[];
  checkWith: { who: "accountant" | "lawyer"; what: string }[];
  tryThis: { name: string; why: string; decisions: RawDecision[] }[];
}

/** One scenario as the advisor sees it. */
export interface ScenarioBrief {
  name: string;
  decisions: string[];
  breakEvenHours: number | null;
  fixedCostShare: number;
  futures: Record<string, {
    profit12: number;
    worstMonth: string;
    lossMonths: number;
    reserveNeeded: number;
    lowestCash: number;
    runwayMonths: number | null;
    hoursTurnedAway: number;
    idleEmployeeHours: number;
    ownerSalaryNetMonthly: number;
    dividendYearNet: number;
    dividendYearToLoan: number;
    dividendYearToOwnerCash: number;
    retainedEarningsEnd: number;
  }>;
}

export interface AdviceInput {
  kind: AdviceKind;
  /** The page's language — the advisor answers in it. */
  language: "English" | "Hebrew";
  today: string;
  studio: {
    ratePerSoldHour: number;
    keysShare: number;
    soldHoursLast3Months: number;
    projectIncome: number;
    office: number;
    otherFixed: number;
    otherPayroll: number;
    ownerAndStaffClientHours: number;
    actualLast3: Baseline["actual"];
    team: { ref: string; initials: string; kind: Member["kind"]; monthlyCost: number; capacity: number; hours: number; billable: number; keys: number; studio: number; pricePerHour: string }[];
  };
  company: Omit<CompanyFacts, "cashFloor"> & { cashFloor: number; arrangementsLaw: number };
  futures: Futures;
  catalogue: { type: string; label: string; fields: string[] }[];
  scenarios: ScenarioBrief[];
}

const r0 = (n: number) => Math.round(n);

export function refsOf(team: Member[]): Map<string, string> {
  return new Map(team.map((m, i) => [m.id, `P${i + 1}`]));
}

/** What the owner calls people, by their first name in the tracker. */
const NICKNAMES: Record<string, string> = {
  katie: "ekaterina",
  melissa: "milica",
  dima: "dmitry",
  // Hebrew spellings, for scenario names written on the Hebrew page.
  "קייטי": "ekaterina",
  "קטיה": "ekaterina",
  "מליסה": "milica",
  "מיליצה": "milica",
  "דימה": "dmitry",
  "נדב": "nadav",
  "אקי": "aki",
  "שקד": "shaked",
  "מיכל": "michal",
  "ניצן": "nitsan",
};

export function briefOf(name: string, decisions: Decision[], r: ScenarioResult, team: Member[], refs: Map<string, string>): ScenarioBrief {
  // The description names people — swap names for their initials + ref.
  // Full names first, then first names alone ("Aki + Katie + Dima").
  const tag = (m: Member) => `${m.initials} (${refs.get(m.id) ?? "?"})`;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = (t: string, w: string, by: string) => t.replace(new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, "giu"), by);
  // People a decision adds (a new freelancer, a hire) go by initials too.
  const added = decisions.filter((d) => (d.type === "freelancer_add" || d.type === "hire") && d.name).map((d) => d.name!.trim());
  const anon = (s: string) => {
    let t = team.reduce((acc, m) => (m.name ? acc.split(m.name).join(tag(m)) : acc), s);
    for (const m of team) {
      const first = m.name.split(/\s+/)[0];
      if (first && first.length > 1) t = word(t, first, tag(m));
      for (const [nick, real] of Object.entries(NICKNAMES)) if (first.toLowerCase() === real) t = word(t, nick, tag(m));
    }
    for (const n of added) if (n.length > 1) t = word(t, n, `${initialsOf(n)} (new)`);
    return t;
  };
  return {
    name: anon(name),
    decisions: decisions.map((d) => `${anon(describe(d, team))} — from ${d.from}`),
    breakEvenHours: r.breakEven == null ? null : r0(r.breakEven),
    fixedCostShare: Math.round(r.fixedShare * 100) / 100,
    futures: Object.fromEntries(
      FUTURE_IDS.map((id) => {
        const f = r.futures[id];
        return [
          id,
          {
            profit12: r0(f.profit),
            worstMonth: `${f.worst.month}: ${r0(f.worst.profit)}`,
            lossMonths: f.lossMonths,
            reserveNeeded: r0(-f.reserve),
            lowestCash: r0(f.lowestCash.cash),
            runwayMonths: f.runway,
            hoursTurnedAway: r0(f.turnedAway),
            idleEmployeeHours: r0(f.idle),
            ownerSalaryNetMonthly: r0(f.salaryNet),
            dividendYearNet: r0(f.dividend.net),
            dividendYearToLoan: r0(f.dividend.toLoan),
            dividendYearToOwnerCash: r0(f.dividend.toYou),
            retainedEarningsEnd: r0(f.retainedEnd),
          },
        ];
      }),
    ),
  };
}

export function adviceInput(
  kind: AdviceKind,
  b: Baseline,
  facts: CompanyFacts,
  cashFloor: number,
  futures: Futures,
  scenarios: ScenarioBrief[],
  refs: Map<string, string>,
  lang: "en" | "he" = "en",
): AdviceInput {
  return {
    kind,
    language: lang === "he" ? "Hebrew" : "English",
    today: b.start,
    studio: {
      ratePerSoldHour: r0(b.rate),
      keysShare: Math.round(b.keysShare * 100) / 100,
      soldHoursLast3Months: r0(b.soldHours),
      projectIncome: r0(b.projectIncome),
      office: r0(b.office),
      otherFixed: r0(b.otherFixed),
      otherPayroll: r0(b.otherPayroll),
      ownerAndStaffClientHours: b.ownerHours + b.staffHours,
      actualLast3: { revenue: r0(b.actual.revenue), costs: r0(b.actual.costs), profit: r0(b.actual.profit), freelance: r0(b.actual.freelance) },
      team: b.team.map((m) => ({
        ref: refs.get(m.id)!,
        initials: m.initials,
        kind: m.kind,
        monthlyCost: r0(m.monthlyCost),
        capacity: r0(m.capacity),
        hours: r0(m.hours),
        billable: r0(m.billable),
        keys: r0(m.keys),
        studio: r0(m.studio),
        pricePerHour: !m.price ? "" : m.price.kind === "flat" ? `${r0(m.price.rate)} ${m.price.currency}` : `${r0(m.price.terms.rateHigh)}→${r0(m.price.terms.rateLow)} ${m.price.currency} (${m.price.terms.hoursLow}–${m.price.terms.hoursHigh}h sliding)`,
      })),
    },
    company: { ...facts, cashFloor, arrangementsLaw: ARRANGEMENTS_LAW },
    futures,
    catalogue: (Object.keys(CATALOGUE) as DecisionType[]).map((t) => ({
      type: t,
      label: CATALOGUE[t].label,
      fields: CATALOGUE[t].fields.map((f) => `${f.key === "personId" ? "personRef" : f.key} (${f.label}${f.kind === "pct" ? ", whole %" : ""})`),
    })),
    scenarios,
  };
}

const ASK: Record<AdviceKind, string> = {
  advise: "Advise on the first scenario below: is it a good move in these times, what to change, what to watch.",
  compare: "Compare the scenarios below side by side and say which to pursue (or which mix), and why — bad future first.",
  suggest: "Look at today's studio and the scenarios already tried, and suggest scenarios the owner hasn't tried that would make the studio more profitable and less risky in the AI shift — big moves and small ones.",
};

export function advisePrompt(input: AdviceInput): string {
  const language =
    input.language === "Hebrew"
      ? "Write every text field of your answer in Hebrew (people's initials and refs, months and figures as given). "
      : "";
  return `${language}${ASK[input.kind]}

All money is ₪ a month unless it says otherwise. The owner's salary stays fixed; the extra he can take is the year's dividend (dividendYear*), limited by profit after company tax and by cash above his floor — it clears the shareholder loan first. "Hours" in the futures are today's sold hours coming in a month. Profit is on the work-month basis (the accountant books by invoice; over two years they match). Cash starts from the company facts' cashToday.

${JSON.stringify(input, null, 1)}`;
}

/** Keep what makes sense: scores in range, decisions that resolve to the team. */
export function acceptAdvice(raw: Advice, team: Member[], refs: Map<string, string>): Omit<Advice, "tryThis"> & { tryThis: { name: string; why: string; decisions: RawDecision[]; resolved: Decision[] }[] } {
  const byRef = new Map([...refs].map(([id, ref]) => [ref, id]));
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    bottomLine: s(raw.bottomLine),
    recommendations: (raw.recommendations ?? [])
      .filter((x) => s(x.title))
      .map((x) => ({ ...x, score: Math.max(1, Math.min(10, Math.round(Number(x.score) || 1))), perMonth: Number(x.perMonth) || 0 }))
      .sort((a, z) => z.score - a.score),
    triggers: (raw.triggers ?? []).filter((x) => s(x.watch)),
    questions: (raw.questions ?? []).map(s).filter(Boolean),
    checkWith: (raw.checkWith ?? []).filter((x) => s(x.what)),
    tryThis: (raw.tryThis ?? []).slice(0, 3).map((t) => ({
      ...t,
      resolved: (t.decisions ?? [])
        .map((d) => {
          const { personRef, ...rest } = d;
          const clean: Record<string, unknown> = { ...rest, personId: byRef.get(s(personRef)) };
          // "" / 0 mean "doesn't apply" in the schema — drop them so defaults hold.
          for (const [k, v] of Object.entries(clean)) if (v === "" || v === undefined) delete clean[k];
          return cleanDecision(clean, team);
        })
        .filter((d): d is Decision => d !== null),
    })),
  };
}
