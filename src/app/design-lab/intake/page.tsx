import { notFound } from "next/navigation";
import { IntakeLab } from "./intake-lab";

/**
 * Design lab, round 7: the client's New Task Brief form (`/intake/[token]`),
 * which the October refresh never reached — it sits outside `.app-canvas`, so
 * none of the global rules apply. Fixture state only, nothing is sent. Dev only.
 */
export const dynamic = "force-dynamic";

export default function IntakeLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <IntakeLab />;
}
