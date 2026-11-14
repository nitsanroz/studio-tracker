import { MonthAmountGrid } from "@/components/finance/month-amount-grid";

export default function FreelancePage() {
  return (
    <MonthAmountGrid
      table="finance_freelance"
      title="Freelance"
      subtitle="Freelance and contractor payments by month."
      block="freelance"
      nameColumn="person_name"
      amountColumn="amount"
      roleColumn="role"
      addLabel="Freelancer name"
      pnlLine="freelance_salaries"
      linkPeople
    />
  );
}
