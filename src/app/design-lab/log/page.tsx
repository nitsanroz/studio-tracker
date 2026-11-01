import { notFound } from "next/navigation";
import { LogLab } from "./log-lab";

/**
 * Design lab, round 7: the freelancer's private page (`/log/[token]`), drawn by
 * the REAL `FreelancerLogView` over an invented freelancer — a real link is a
 * credential, so the page is checked here instead. Dev only.
 */
export const dynamic = "force-dynamic";

export default function LogLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LogLab />;
}
