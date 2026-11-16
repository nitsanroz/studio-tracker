/**
 * The old finance app's address, after &all (v2.0.0): `finance.nmore.co` is
 * served by THIS project and every request is sent on to the same page here.
 * Its pages lived at the root (/plan, /salaries…); here they are under
 * /finance — a plain domain redirect would have sent /plan to the WEEKLY plan.
 * Rollback: point the domain back at the finance-admin project.
 */
export const OLD_FINANCE_HOST = "finance.nmore.co";
export const TRACKER_ORIGIN = "https://tracker.studionmore.com";

/** Where a request to the old finance host goes, or null for any other host. */
export function financeHostTarget(host: string | null, pathname: string, search: string): string | null {
  if (!host || host.toLowerCase().split(":")[0] !== OLD_FINANCE_HOST) return null;
  const path = pathname === "/" || pathname === "" ? "/finance" : pathname.startsWith("/login") ? pathname : `/finance${pathname}`;
  return `${TRACKER_ORIGIN}${path}${search}`;
}
