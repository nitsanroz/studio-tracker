import { notFound } from "next/navigation";
import { FreelancersLab } from "./freelancers-lab";

/**
 * Design lab, round 6: content options for Freelancers — the list and one
 * freelancer's month. Fixture data only, an invented freelancer. Dev only.
 */
export const dynamic = "force-dynamic";

export default function FreelancersLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FreelancersLab />;
}
