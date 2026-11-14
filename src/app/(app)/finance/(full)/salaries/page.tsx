import { MonthAmountGrid } from "@/components/finance/month-amount-grid";

export default function SalariesPage() {
  return (
    <MonthAmountGrid
      table="finance_salaries"
      title="Salaries"
      subtitle="Name and monthly amount only — bank details and IDs stay in Excel."
      block="salaries"
      nameColumn="employee_name"
      amountColumn="gross_amount"
      addLabel="Employee name"
      pnlLine="salaries"
      linkPeople
    />
  );
}
