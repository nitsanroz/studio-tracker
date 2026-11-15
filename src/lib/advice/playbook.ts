// What a consultant to small agencies knows going in — the benchmarks and
// decision rules behind &advice's business cards and its "Review the business"
// prompt. Researched 2026-11-15 from agency benchmark reports and recognised
// practitioners; the full notes, with every source and what could not be
// verified, are in docs/advice-playbook.md.
//
// ⚠️ RULES OF THUMB, NOT LAW. Almost all of it is US-centric and drawn from
// digital and marketing agencies; design-studio-only data is thin, and several
// figures are practitioners' conventions rather than measurements. The cards
// say "a rule of thumb" for that reason, and the prompt tells Claude the same.
// Nothing here is about Studio&more: no figure of the studio's is in this file,
// so it is safe in a browser bundle.

/** Thresholds the deterministic cards use (business.ts). Each names its source. */
export const BENCH = {
  /** Designers' billable share of a full year: healthy 65–80% (Parakeeto). Under this, sell before hiring. */
  utilizationLow: 0.65,
  /** Sustained above this there is no slack left; add capacity, freelancer first (Parakeeto; Promethean). */
  utilizationHigh: 0.85,
  /** The share a full team should be able to bill — the middle of the healthy range. */
  utilizationTarget: 0.75,
  /** People cost (salaries + freelancers) as a share of fee income: 45% or less (David C. Baker). */
  peopleShare: 0.45,
  /** Past this the card speaks; the 45% is a US rule of thumb, so it waits for a clear miss. */
  peopleShareWarn: 0.55,
  /** Largest client's share of the work: amber at 25%, red at 35% (Baker and Enns, 2Bobs). */
  clientAmber: 0.25,
  clientRed: 0.35,
  /** The top three together: 50% or less (2Bobs). */
  topThree: 0.5,
  /** Rates are raised on a schedule, yearly (5–10% is the common convention). */
  rateAgeMonths: 12,
  /** A freelancer needed steadily for more than ~20–24h a week is worth comparing with a hire. */
  freelancerSteadyHours: 87,
  /** Nearly all income sold by the hour: the model AI speed gains erode (Blair Enns, 2Bobs 2026). */
  hourlyShare: 0.8,
} as const;

/**
 * The background Claude reads before the studio's own brief. Plain prose, no
 * figure of the studio's. Kept short on purpose: it is context for judgement,
 * not a checklist to recite.
 */
export const PLAYBOOK = `BACKGROUND — what consultants to small agencies and studios work from (2025–2026). These are rules of thumb from US-centric benchmark reports (Promethean Research, Parakeeto) and practitioners (David C. Baker, Blair Enns, Karl Sakas). Design-studio-only data is thin. Use them to judge, say "a rule of thumb" when you lean on one, and never present one as a law or as this studio's own figure.

Financial shape
- Net margin: 10–20% is healthy; the 2025 agency average was about 13%, design-led agencies about 18%. Under 10% is a warning.
- People cost (salaries plus freelancers) at or under about 45% of fee income; overhead 20–30%.
- The cost of an hour of delivery is typically about a third of the rate it sells for. When it is much more, the fix is price or mix, not more hours.
- If margin is thin, fix pricing, scoping and utilization before cutting overhead: overhead is rarely the problem.

Team
- Designers bill 65–80% of a full year in a healthy studio. Under 65%: do not hire; sell, or shrink the bench. Sustained above 85–90%: no slack for holidays, sickness or a new client — add capacity, a freelancer first. Busy but unprofitable is a pricing problem; hiring multiplies it.
- A freelancer needed steadily for more than about 20–24 hours a week is worth comparing with a hire.
- An owner's billable time should fall as the firm grows; at around six people about half the owner's time is still delivery. If a short absence of the owner creates risk, build a second-in-command in stages.

Clients
- Largest client under 25% of the work (amber at 25%, structural risk at 35%); the top three at or under half; eight or more active clients. The cure for concentration is another large client, not many small ones.
- A client whose work leaves too little after its people, even after re-scoping, is repriced at renewal or let go.
- When actual hours run more than 20% over the estimate the cause is scoping: a written change order before the extra work starts.

Pricing
- Rates are raised on a schedule, usually yearly (5–10% is the common convention), with 30–60 days' notice. New pricing goes to new clients first from a fixed date; legacy clients convert at renewal. A client base turns over in about three to four years.
- Keep tracking time as a costing tool even when the price is not hourly.

Cash and new business
- Two to four months of operating costs in reserve. Payment collected in 30–45 days; deposits and billing retainers in advance shorten it.
- A forecast that reliably covers four to six months; agencies spending under about 5% of income on sales and marketing are running hot.
- Agencies that narrowed their services grew faster at better margins than those that added.

The AI era (2025–2026)
- Margins are compressing across agencies, and hourly billing now penalises speed: a studio that gets faster with AI earns less for the same result if it sells hours. The path leading practitioners describe is from pricing inputs (hours) to outputs (fixed-price or productized work) to value — starting with new clients, never all at once.
- About a third of agencies have been asked for an "AI discount". The answer is to move the conversation from hours to a fixed deliverable or outcome, not to cut the rate.
- Clients are taking routine production in-house; what they still buy from outside is senior judgement: strategy, brand, systems thinking, art direction and taste. Demand for design has shifted senior rather than collapsed; juniors and freelancers absorb most of the impact.
- Specialised, design-led firms have held the best margins. In an unstable market, keep fixed costs flexible (freelancers are the buffer) and the reserve fuller.

Israel — general information, not advice; the accountant decides
- The default legal payment term between private businesses is shotef+45 (45 days from the end of the invoice month) unless agreed otherwise.
- Since 2025 a closely held company chooses each year between a surcharge on certain undistributed profits and distributing part of them, so the timing of salary, bonus and dividend is a real year-end question.`;
