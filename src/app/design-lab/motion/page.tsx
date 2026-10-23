import { notFound } from "next/navigation";
import { MotionLab } from "./motion-lab";

/**
 * Design lab, round 8: motion, loaders, feedback, hover, gestures, empty states
 * and icons — each with options to try by hand. Fixture content, dev only.
 */
export const dynamic = "force-dynamic";

export default function MotionLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MotionLab />;
}
