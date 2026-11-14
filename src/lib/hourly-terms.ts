// ⚠️ SERVER ONLY — a freelancer's ₪ rate. Its own file so that hours-goal.ts,
// which holds the goal's arithmetic and nothing personal, can be used by client
// pages (finance's Overview works the goal out in the browser). Client code gets
// the terms as a prop from `(full)/layout.tsx`, after the tier check
// (useCompanyFigures().hourlyTerms); finance-leak-guard.test.ts keeps it that way.
import type { RateTerms } from "./freelance-rate";

/** Hourly freelancers on a sliding ₪ rate, by tracker profile id. Dima:
 * ₪140/h up to 50h a month, down in a straight line to ₪100/h at 150h
 * (his sheet: =IF(h<=50, 140, IF(h>=150, 100, 140 - (h - 50) * 0.4))). */
export const HOURLY_TERMS: Record<string, RateTerms> = {
  "945eacad-3d33-4a69-b4a4-40b6f5c9ce8b": { currency: "ILS", rateHigh: 140, rateLow: 100, hoursLow: 50, hoursHigh: 150 },
};
