import { MonthAmountGrid } from "@/components/finance/month-amount-grid";
import { FREELANCER_VIEWS, PageViews } from "@/components/page-views";

/** Freelancers' "Payments" view: what each month costs. Their hours are the tracker's /freelancers. */
export default function FreelancePage() {
  return (
    <>
      <PageViews views={FREELANCER_VIEWS} className="mb-3" />
      <MonthAmountGrid
        table="finance_freelance"
        title="Freelancers"
        subtitle="Freelance and contractor payments by month."
        block="freelance"
        nameColumn="person_name"
        amountColumn="amount"
        roleColumn="role"
        addLabel="Freelancer name"
        pnlLine="freelance_salaries"
        linkPeople
      />
    </>
  );
}
