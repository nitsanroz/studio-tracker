"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTier } from "@/components/tier-context";
import { atLeast } from "@/lib/access";
import { PageSkeleton } from "@/components/skeleton";
import { FreelancerCards } from "./cards";

/**
 * Freelancers. With full finance this is ONE page with Payments — the cards are
 * its default view, the table the other, trends beside both (Nitsan,
 * 2026-11-16) — and it lives at /finance/freelance, behind finance's server
 * gate. Anyone else (an admin without full finance) gets the cards here.
 */
export default function FreelancersPage() {
  const tier = useTier();
  const router = useRouter();
  const merged = atLeast(tier, "finance");
  useEffect(() => {
    if (merged) router.replace("/finance/freelance");
  }, [merged, router]);
  if (merged) return <PageSkeleton side={false} />;
  return <FreelancerCards />;
}
