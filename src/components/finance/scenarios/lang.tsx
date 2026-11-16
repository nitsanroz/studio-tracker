"use client";

// The Scenarios page's language (English / Hebrew). Hebrew turns the page right-to-left; the
// charts and number bars stay left-to-right so the figures read as figures.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { EN, tFor, type Lang, type T } from "@/lib/finance/scenarios/i18n";
import { AdviceLangSwitch, useAdviceLang } from "@/components/advice-lang";

// One language for the advisor's two tabs (2026-11-15): Scenarios reads and
// sets &advice's choice (localStorage "advice.lang"), so switching on one tab
// holds on the other. Its old key, "scenarios.lang", is no longer read.

const Ctx = createContext<{ lang: Lang; t: T; setLang: (l: Lang) => void }>({ lang: "en", t: EN, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useAdviceLang();
  const t = useMemo(() => tFor(lang), [lang]);
  return (
    <Ctx.Provider value={{ lang, t, setLang }}>
      <div dir={lang === "he" ? "rtl" : "ltr"} lang={lang}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export const useT = () => useContext(Ctx);

/** EN | עב — the advisor's own switch, so it looks and sits the same on both tabs. */
export function LangSwitch() {
  return <AdviceLangSwitch />;
}
