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
  const asked: AdvisorTab = params.get("tab") === "scenarios" ? "scenarios" : "advice";
  const [tab, setTabState] = useState<AdvisorTab>(asked);
  const [opened, setOpened] = useState<Set<AdvisorTab>>(() => new Set([asked]));
  // A link to the other tab followed while already here (the pane's "Open
  // Scenarios") changes only the address — follow it, during render.
  const [seen, setSeen] = useState(asked);
  if (seen !== asked) {
    setSeen(asked);
    setTabState(asked);
    setOpened((o) => (o.has(asked) ? o : new Set([...o, asked])));
  }
  const setTab = (t: AdvisorTab) => {
    setTabState(t);
    setOpened((o) => (o.has(t) ? o : new Set([...o, t])));
    // the address follows, without a navigation
    const url = new URL(window.location.href);
    if (t === "scenarios") url.searchParams.set("tab", "scenarios");
    else url.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", url);
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
