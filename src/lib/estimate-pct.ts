/** The percent-of-estimate chip on a client report — pure, so it is tested here. */

/**
 * How much of an estimate has been used, as a chip beside it.
 *
 * Returns null when there is nothing honest to say — no estimate, or an estimate
 * of zero, where a percentage would be a division by zero dressed up as insight.
 */
export function estimatePct(minutes: number, estimateHours: number | null): number | null {
  if (estimateHours == null || estimateHours <= 0) return null;
  return Math.round((minutes / 60 / estimateHours) * 100);
}

/**
 * The chip's colour: GREEN at exactly 100, RED above it, plain below.
 *
 * ⚠️ NOT the cap's scale, and the difference is the point. This first reused
 * `capTone` (amber from 70%, red from 90%) on the reasoning that "95% of an
 * estimate and 95% of a cap mean the same thing". Nitsan overruled it and he is
 * right: a task landing ON its estimate is a job done as planned — worth
 * celebrating, not warning about — whereas a period at 90% of its cap is a
 * warning by definition. Below 100 the figure is unremarkable and stays plain.
 */
export function estimateTone(pct: number): string {
  if (pct > 100) return "text-danger";
  if (pct === 100) return "text-success";
  return "";
}
