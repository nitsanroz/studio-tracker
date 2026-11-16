"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdviceBoardView } from "@/components/advice-board-view";
import { ScenariosView } from "@/components/finance/scenarios/scenarios-view";
import { LangProvider } from "@/components/finance/scenarios/lang";
import { AdvisorTabs, type AdvisorTab } from "@/components/advice-top";

/**
 * The advisor: &advice and Scenarios as two tabs of ONE page (Nitsan,
 * 2026-11-16: "switching time in scenarios/advice page can be shortened,
 * especially if nothing changed and nothing needs to reload"). They were two
 * routes, so every switch went back to the server and remounted the page —
 * Scenarios' first draw took 2–2.6s. Now the switch is local: a tab is mounted
 * the first time it's opened and then only hidden, so going back to it is
 * instant and nothing reloads. `?tab=scenarios` opens Scenarios
 * (/finance/scenarios redirects here). The owner-only gate and Scenarios'
 * figures come from the layout.
 */
export default function AdvisorPage() {
  const params = useSearchParams();
  // The address IS the tab: a switch writes it with replaceState (which Next's
  // useSearchParams follows), and a link to ?tab= followed while already here
  // (the pane's "Open Scenarios") lands the same way.
  const tab: AdvisorTab = params.get("tab") === "scenarios" ? "scenarios" : "advice";
  // A tab once opened stays mounted (only hidden).
  const [opened, setOpened] = useState<Set<AdvisorTab>>(() => new Set([tab]));
  if (!opened.has(tab)) setOpened(new Set([...opened, tab]));
  const setTab = (t: AdvisorTab) => {
    const url = new URL(window.location.href);
    if (t === "scenarios") url.searchParams.set("tab", "scenarios");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  };
  return (
    <AdvisorTabs.Provider value={{ tab, setTab }}>
      {opened.has("advice") && (
        <div hidden={tab !== "advice"}>
          <AdviceBoardView />
        </div>
      )}
      {opened.has("scenarios") && (
        // `finance-canvas`: Scenarios' figures blur with Discreet mode, as on finance's pages
        <div hidden={tab !== "scenarios"} className="finance-canvas">
          <LangProvider>
            <ScenariosView />
          </LangProvider>
        </div>
      )}
    </AdvisorTabs.Provider>
  );
}
