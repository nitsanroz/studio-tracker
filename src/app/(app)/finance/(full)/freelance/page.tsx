"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MonthAmountGrid } from "@/components/finance/month-amount-grid";
import { FreelancerCards } from "../../../freelancers/cards";
import { ViewSwitch } from "@/components/page-views";

type View = "cards" | "payments";

/**
 * Freelancers — ONE page (Nitsan, 2026-11-16: "merge 2 pages, so cards fit in
 * payments page as alternate tab to the table … they should be the default
 * view; right pane of trends can stay always"). The cards are the default; the
 * month-by-month payments table is the other tab; the trends pane sits beside
 * both. It stays under /finance, behind finance's server gate; /freelancers
 * sends full-finance users here. `?view=payments` — or a `?year=`, which is how
 * &advice links to a month's payments — opens the table.
 */
export default function FreelancePage() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const view: View = params.get("view") === "payments" || params.has("year") ? "payments" : "cards";
  const pick = (v: View) => {
    const q = new URLSearchParams(params);
    if (v === "payments") q.set("view", "payments");
    else {
      q.delete("view");
      q.delete("year");
    }
    const s = q.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  };
  const switcher = (
    <ViewSwitch<View>
      className="mb-4"
      value={view}
      onChange={pick}
      options={[
        ["cards", "Freelancers"],
        ["payments", "Payments"],
      ]}
    />
  );
  return (
    <MonthAmountGrid
      table="finance_freelance"
      title="Freelancers"
      subtitle="Their hours, this month's bill and what waits for review — and every month's payments."
      block="freelance"
      nameColumn="person_name"
      amountColumn="amount"
      roleColumn="role"
      addLabel="Freelancer name"
      pnlLine="freelance_salaries"
      linkPeople
      viewSwitch={switcher}
      alt={view === "cards" ? <FreelancerCards inPage /> : undefined}
    />
  );
}
