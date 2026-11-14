import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access-server";
import { atLeast } from "@/lib/access";

// Decided per request from the viewer's own profile — never prerendered.
export const dynamic = "force-dynamic";

/**
 * The server gate for everything under /finance.
 *
 * A member gets the app's 404: they have no finance at all, and no reason to
 * learn which pages exist. An admin without full finance (Michal) gets past
 * here but only as far as Expenses — every other page sits under `(full)/`,
 * whose layout asks for the finance tier, and Scenarios asks for the owner.
 *
 * This is the app half. The database half is the finance tables' own RLS: the
 * pages read with the viewer's session, so nothing comes back that the
 * policies wouldn't give them, whatever this file does.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (!atLeast(tier, "admin")) notFound();
  return <div className="finance-canvas">{children}</div>;
}
