// A freelancer's sliding hourly rate (0054 `freelancers`): the more hours in a
// month, the lower the rate — `rateHigh` at or below `hoursLow`, falling in a
// straight line to `rateLow` at or above `hoursHigh`. AB's terms, from the sheet
// he billed from: €55/h at 50h down to €45/h at 150h, so 139h → €46.10/h.

export interface RateTerms {
  currency: string;
  rateHigh: number;
  rateLow: number;
  hoursLow: number;
  hoursHigh: number;
}

/** The rate for a month of `hours`, rounded to the cent like the sheet's. */
export function rateFor(hours: number, t: RateTerms): number {
  if (hours <= t.hoursLow) return t.rateHigh;
  if (hours >= t.hoursHigh) return t.rateLow;
  const share = (hours - t.hoursLow) / (t.hoursHigh - t.hoursLow);
  return Math.round((t.rateHigh - (t.rateHigh - t.rateLow) * share) * 100) / 100;
}

/** A month's bill: every hour at that month's rate. */
export function billFor(hours: number, t: RateTerms): number {
  return Math.round(hours * rateFor(hours, t) * 100) / 100;
}
