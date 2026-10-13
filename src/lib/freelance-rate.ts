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

/** An extra charge on a freelancer's month (0057) — another freelancer he
 * brought in, a purchase — money on top of his hours. */
export interface Charge {
  amount: number;
  currency: string;
  status: string;
}

/** The month's whole bill: hours × that month's rate, plus every charge not
 * turned down. Charges in his own currency add to the total; any in another
 * currency are kept apart rather than converted at a guessed rate. */
export function monthBill(hours: number, t: RateTerms, charges: Charge[]) {
  const counted = charges.filter((c) => c.status !== "rejected");
  const extras = Math.round(counted.filter((c) => c.currency === t.currency).reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const other = new Map<string, number>();
  for (const c of counted) if (c.currency !== t.currency) other.set(c.currency, (other.get(c.currency) ?? 0) + c.amount);
  const hoursBill = billFor(hours, t);
  return {
    hours,
    rate: rateFor(hours, t),
    hoursBill,
    extras,
    otherExtras: [...other].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
    total: Math.round((hoursBill + extras) * 100) / 100,
  };
}
