import { notFound } from "next/navigation";
import { AdvisorLab } from "./advisor-lab";

/**
 * Design lab, round 7: the owner's advisor pane — three looks for the pull-out
 * panel that gives Nitsan heads-ups, reminders and suggestions. Fixture data
 * only, invented clients and people. Dev only.
 */
export const dynamic = "force-dynamic";

export default function AdvisorLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdvisorLab />;
}
