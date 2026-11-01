import { notFound } from "next/navigation";
import { DailyLab } from "./daily-lab";

/**
 * Design lab, round 7: the two pages a designer opens every day — My Tasks and
 * the Time Feed — which the October refresh reached only through its global
 * rules. Fixture data, invented clients. Dev only.
 */
export const dynamic = "force-dynamic";

export default function DailyLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DailyLab />;
}
