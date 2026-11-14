"use client";

// The Scenarios page's language (English / Hebrew), remembered per browser
// (localStorage "scenarios.lang"). Hebrew turns the page right-to-left; the
// charts and number bars stay left-to-right so the figures read as figures.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { EN, tFor, type Lang, type T } from "@/lib/finance/scenarios/i18n";

const KEY = "scenarios.lang";

const Ctx = createContext<{ lang: Lang; t: T; setLang: (l: Lang) => void }>({ lang: "en", t: EN, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "he") setLangState("he");
    } catch {
      /* private window: English */
    }
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* not kept — fine */
    }
  };
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

/** EN | עב */
export function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <div className="inline-flex rounded-full bg-surface p-1 shadow-card" role="group" aria-label="Language / שפה">
      {(["en", "he"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-3.5 py-1 text-[15px] font-medium ${lang === l ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
        >
          {l === "en" ? "EN" : "עב"}
        </button>
      ))}
    </div>
  );
}
