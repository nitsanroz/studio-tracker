import { notFound } from "next/navigation";
import { CandidatesLab } from "./candidates-lab";

/**
 * Design lab, round 4: content options for the Candidates list and a
 * candidate's page. Fixture data only — invented applicants, so no real
 * applicant's details end up in a mockup. Dev only, like /design-lab.
 */
export const dynamic = "force-dynamic";

export default function CandidatesLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CandidatesLab />;
}
