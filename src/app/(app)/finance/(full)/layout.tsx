import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access-server";
import { atLeast } from "@/lib/access";

/**
 * Every finance page except Expenses: full finance access only. `(full)` is a
 * route group — it adds nothing to the URL. An admin without the flag is sent
 * to the one finance page they have, as the finance app's proxy used to do.
 */
export default async function FullFinanceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (!atLeast(tier, "finance")) redirect("/finance/expenses");
  return children;
}
