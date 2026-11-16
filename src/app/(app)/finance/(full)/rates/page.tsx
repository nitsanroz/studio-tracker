import { redirect } from "next/navigation";

/**
 * Rates is no longer a page (Nitsan, 2026-11-15): each client's current rate is
 * a column of Clients, and its history and changes open from there
 * (components/finance/client-rates.tsx). The address still answers — &advice's
 * "no rate" cards and old bookmarks — by sending you there, with the client and
 * the month to cover when the link names them.
 */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ client?: string; from?: string }> }) {
  const { client, from } = await searchParams;
  const q = new URLSearchParams();
  if (client) q.set("rate", client);
  if (client && from) q.set("from", from);
  redirect(q.size ? `/clients?${q}` : "/clients");
}
