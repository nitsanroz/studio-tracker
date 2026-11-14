import { createBrowserClient } from "@supabase/ssr";
import { schedulePnlRefresh } from "@/lib/finance/auto-rollup";

/** Tables whose rows feed this year's P&L: a saved change to any of them
 * recomputes it (see auto-rollup). A client's rate prices its hours. */
const FEEDS_PNL = /\/rest\/v1\/(finance_salaries|finance_freelance|finance_expenses|finance_income|client_rates)\b/;

/** Every browser write goes through here, so no save point can forget to
 * refresh the P&L — today's or one added later. */
const watchedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (method !== "GET" && method !== "HEAD" && res.ok && FEEDS_PNL.test(url)) schedulePnlRefresh();
  return res;
};

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: watchedFetch } },
  );
}
