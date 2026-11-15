# &advice — the consultant's playbook

Research notes behind `src/lib/advice/playbook.ts` (the thresholds of the strategic
cards, and the background Claude reads before "Review the business"). Researched
2026-11-15 from public sources; nothing here is about Studio&more.

Tags: **[BR]** benchmark report · **[RoT]** practitioner rule of thumb · **[1S]** single
source. A trailing **\*** means the figure was seen only in a search summary — the page
was paywalled or unreadable. Treat starred numbers as unverified.

## Read this first

- Almost everything is **US-centric**, in US dollars, and from digital or marketing
  agencies. Design-studio-only data is thin.
- "Margin" means different things: Promethean reports after-tax net, Parakeeto reports
  pre-tax operating margin on adjusted gross income. Don't mix them.
- Rate-increase size, deposit size, freelancer share and hiring triggers are
  convention, not measured.
- Several AI statistics trace to vendor surveys (Productive, Figma).

So the cards say "a rule of thumb", and a benchmark never outranks the studio's own figures.

## Benchmarks

| Metric | Healthy range | Warning sign | Source |
|---|---|---|---|
| Net margin (after tax) | 10–20%; 2025 average 13%; design agencies 18% | Under 10% | Promethean 2026 [BR] |
| Operating margin (pre-tax) | Most agencies 10–15%; target 25% | Under 10% | Parakeeto [RoT] |
| Delivery margin | 50%+ agency-wide; 60–70% per project | Under 50% | Parakeeto [RoT] |
| Overhead | 20–30% of income | Over 35–40% | Parakeeto; Promethean [RoT] |
| People cost | 45% or less of fee income | Over 45% | Baker [RoT]* |
| Rate vs cost per hour | Delivery cost ≈ a third of the rate (≈3× markup) | Under 2.5× | Parakeeto [RoT] |
| Utilization, designers | 65–80% over a year | Over 85–90% sustained; under 65% | Parakeeto; Promethean [RoT] |
| Utilization, whole firm | 50–60%+ | 42–55% is the actual average | Parakeeto; Baker* |
| Estimating accuracy | Within 10%; 20% tolerable | Over 20% | Parakeeto [RoT] |
| Largest client | Under 25% | 25% amber, 35% red | Baker and Enns, 2Bobs [RoT] |
| Top three clients | 50% or less | 75%+ | 2Bobs [RoT] |
| Number of clients | 8 or more | Under 8 | Baker [RoT]* |
| Cash reserve | 2–4 months of costs | Under 1 month | Promethean [RoT] |
| Days to get paid | 30–45; 10–20 with retainers billed in advance | 50–60+ | SPI via secondary [BR]* |
| Sales and marketing spend | 7% average; 11–14% to grow ~20% a year | Under 5% | Promethean [BR/RoT] |
| Pipeline | Forecast 4–6 months ahead; 3–5× coverage | No forecast | Promethean; Anders* |

## Decision rules

1. Delivery margin under 50% → fix pricing, scoping or utilization before overhead. [Parakeeto]
2. Cost per hour over about a third of the rate → raise rates or change the mix; don't push hours. [Parakeeto]
3. Designers above 85–90% for weeks, turning away profitable work → add capacity, freelancer first. Busy but unprofitable → hiring multiplies the problem. [RoT]
4. Annual designer utilization under 65% → don't hire; sell, or shrink the bench. [Parakeeto]
5. A freelancer needed steadily for more than ~20–24h a week → compare with a hire. [1S]*
6. One client past 25% → start mitigating; at 35%, structural risk. Win another large client rather than many small ones. [2Bobs]
7. A client's delivery margin under ~50% after re-scoping → reprice at renewal or exit. [RoT]
8. Actuals over estimates by more than 20% → the cause is scoping; a written change order before extra work. [Parakeeto]
9. Raise rates on a schedule — 5–10% a year is the common convention; 30–60 days' notice. [RoT, weak sources*]
10. New pricing to new clients first from a fixed date; legacy clients at renewal. A client base turns over in ~3–4 years. [Enns, 2Bobs 2026]
11. A client asks for an "AI discount" → move from hours to a fixed deliverable or outcome price. [Productive 2025]
12. Cash under two months of costs → tighten terms before spending: deposits, retainers in advance, shorter terms.
13. A forecast that doesn't cover 4–6 months → new business is under-resourced. [Promethean]
14. A short owner absence creates risk → build a number two in stages. [Sakas]
15. Owner billable time falls as the firm grows: about half at ~6 people, zero past 20. No published split for 8–15. [Baker*; Promethean]
16. Tempted to add services → cut instead: agencies that narrowed grew faster at better margins. [Promethean 2026]
17. Keep time tracking as a costing tool even when the price is not hourly. [Baker, 2Bobs 2026]

## The AI era (2025–2026)

- **Margins are compressing.** Net margin 14% (2024) → 13% (2025) against a long-run 15%. [Promethean, Mar 2026]
- **Hourly billing penalises speed.** Enns calls labour-based pricing dead and AI the forcing function: inputs → outputs (fixed or productized) → value. No firm value-prices everything. [2Bobs, Mar 2026]
- **Clients ask for discounts, yet most agencies gain.** About a third were asked; most say AI lifts revenue or profit. [Productive, Nov 2025]
- **Routine work moves in-house.** Clients keep production and send high-value work to smaller, non-hourly firms. [Enns; Gartner*]
- **Design demand has shifted senior, not collapsed.** 47% of design leaders report rising demand, 18% falling; 56% want more seniors vs 25% juniors. Visual polish, systems thinking and product strategy are the top-valued skills. [Figma, Feb 2026 — mostly in-house teams]
- **Juniors and freelancers absorb the impact**: hires delayed, outsourced tasks replaced. [Productive 2025]
- **Specialising pays.** Design agencies had the highest net margin by type (18%). [Promethean 2026]
- **Keep costs flexible.** Freelancers are the buffer; the reserve is fuller when the outlook is unclear. [Promethean]

## Israel — general information, not advice

- **Payment terms:** the 2017 supplier-payments law sets a default of shotef+45 for
  private businesses, unless agreed otherwise. The state pays at shotef+30. [Kol Zchut]
- **Undistributed profits:** from 1 January 2025 a closely held company chooses each year
  between a surcharge on certain undistributed profits and distributing part of them. [EY alert]
- Salary-versus-dividend rates were found only on unverified secondary pages. The accountant decides.

## Sources read

- Promethean Research — 2026 State of Digital Services; How Profitable are Digital Agencies? (2026); Assessing Agency Fragility — prometheanresearch.com
- Parakeeto — 8 Vital Agency Metrics & KPIs (2025) — parakeeto.com/blog/agency-metrics
- 2Bobs (David C. Baker, Blair Enns) — Is AI Going to Kill Labor-based Pricing? (2026); Six Hidden Benefits of Client Concentration — 2bobs.com
- Sakas & Company — Why agencies struggle to scale without an independent #2 — sakasandcompany.com
- Productive — Agencies in the AI Era (Nov 2025) — productive.io/blog/agencies-in-the-ai-era
- Figma — Why Demand for Designers Is on the Rise (Feb 2026) — figma.com/blog
- Kol Zchut — supplier payment deadlines; EY — Israel legislative changes affecting private companies (2025)

Seen in search summaries only: David C. Baker's eight benchmarks, Anders CPA on pipeline,
SoDA Agency Outlook '26, SPI utilization (via a secondary article).
