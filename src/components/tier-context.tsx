"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Tier } from "@/lib/access";
import { useDataMaybe } from "@/lib/store";

/**
 * The viewer's access tier, for pages that offer a way into finance (the
 * merge's stage 5: Freelancers ↔ Finance's Freelance, a member's page ↔ their
 * finance page). It comes from the SERVER layout — the viewer's own profile —
 * through AppShell.
 *
 * ⚠️ A CONVENIENCE, NOT A LOCK. It only decides whether a link is drawn; the
 * finance layouts and the database decide who gets in. And while previewing
 * someone (`?viewAs=`) it reads "member": the link would open the admin's
 * finance, not theirs.
 */
const TierContext = createContext<Tier>("member");

export function TierProvider({ tier, children }: { tier: Tier; children: ReactNode }) {
  return <TierContext.Provider value={tier}>{children}</TierContext.Provider>;
}

export function useTier(): Tier {
  const tier = useContext(TierContext);
  const viewingAs = useDataMaybe()?.viewingAs;
  return viewingAs ? "member" : tier;
}
