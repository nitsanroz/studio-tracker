import { notFound } from "next/navigation";
import { LeadsLab } from "./leads-lab";

/**
 * Design lab, round 5: content options for the Leads board cards and a lead's
 * page. Fixture data only — invented companies and people. Dev only.
 */
export const dynamic = "force-dynamic";

export default function LeadsLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LeadsLab />;
}
