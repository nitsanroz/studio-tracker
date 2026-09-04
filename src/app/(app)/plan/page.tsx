"use client";

import { useIsNarrow } from "@/lib/use-is-narrow";
import { WeeklyPlan } from "@/components/weekly-plan";
import { PlanMobile } from "@/components/plan-mobile";

/**
 * ⚠️ CHOSEN IN JS, NOT WITH `md:hidden`, and the reason is the same one
 * `/clients` has: rendering both would MOUNT both, and the desktop grid is a
 * ~1,350-line table that walks every plan entry across a 41-day range. One of
 * these exists at a time. See `plan-mobile.tsx` for why they are separate
 * components rather than one responsive one.
 */
export default function PlanPage() {
  const narrow = useIsNarrow();
  return narrow ? <PlanMobile /> : <WeeklyPlan />;
}
