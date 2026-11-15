import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access-server";

/**
 * /advice is the OWNER's alone, like the pane it lays out in full: the page
 * shows amounts (what an hour sells for and costs), so not every admin — Michal
 * is one — and not every full-finance user. Anyone else gets a 404: they have
 * no reason to learn the page exists.
 *
 * This guard keeps the page shut; the data is shut separately — /api/advice
 * answers 403 to anyone but the owner, and the store's policy is
 * `is_finance_owner()`.
 */
export default async function AdviceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (tier !== "owner") notFound();
  return children;
}
