"use client";

// &advice's language — English or Hebrew — for the pane and the /advice page.
// One choice for both, remembered per browser (localStorage "advice.lang") and
// kept in step between them while both are on screen.
//
// Two layers of Hebrew: the interface's fixed text (lib/advice/he-ui.ts), and
// the cards' own sentences, which the server translates and remembers
// (lib/advice/hebrew.ts, POST /api/advice/translate). A sentence with no Hebrew
// yet shows in English until its translation lands.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fixedHebrew, uiT, type AdviceLang, type UiT } from "@/lib/advice/he-ui";

const KEY = "advice.lang";
const EVENT = "advice:lang";

function read(): AdviceLang {
  try {
    return window.localStorage.getItem(KEY) === "he" ? "he" : "en";
  } catch {
    return "en";
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useAdviceLang(): [AdviceLang, (l: AdviceLang) => void] {
  const lang = useSyncExternalStore<AdviceLang>(subscribe, read, () => "en");
  const set = useCallback((l: AdviceLang) => {
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      /* a private window: the choice lasts until the page is left */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [lang, set];
}

/** How many sentences one request carries (the route's own limit is 400). */
const CHUNK = 200;

export interface Hebrew {
  /** the interface's fixed text */
  t: UiT;
  /** a card's sentence in the chosen language — English until its Hebrew is in */
  tr: (s: string) => string;
  rtl: boolean;
  /** translations are on their way */
  busy: boolean;
  /** why some sentences stayed in English, in the interface's words; null when all is well */
  off: string | null;
}

/**
 * The chosen language and the Hebrew of `texts` — the sentences on screen
 * (lib/advice/texts.ts `viewTexts`). In English it asks for nothing.
 */
export function useHebrew(lang: AdviceLang, texts: string[]): Hebrew {
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState<string | null>(null);
  // Asked once each: a sentence Claude wouldn't translate isn't asked for on every render.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (lang !== "he") return;
    const missing = texts.filter((s) => !asked.current.has(s) && fixedHebrew(s) === undefined);
    if (!missing.length) return;
    for (const s of missing) asked.current.add(s);
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));
    setBusy(true);
    void Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch("/api/advice/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: chunk }) }).catch(() => null);
        if (!res?.ok) {
          // Not remembered as asked: the next view change tries again.
          for (const s of chunk) asked.current.delete(s);
          return { he: {}, off: "Some of it couldn't be translated — try again" };
        }
        return (await res.json()) as { he: Record<string, string>; off: string | null };
      }),
    ).then((answers) => {
      setMap((m) => Object.assign({}, m, ...answers.map((a) => a.he)));
      setOff(answers.find((a) => a.off)?.off ?? null);
      setBusy(false);
    });
  }, [lang, texts]);

  return useMemo(() => {
    const t = uiT(lang);
    const tr = (s: string) => {
      if (lang !== "he") return s;
      const k = s.trim();
      return fixedHebrew(k) ?? map[k] ?? s;
    };
    return { t, tr, rtl: lang === "he", busy: lang === "he" && busy, off: lang === "he" && off ? t(off) : null };
  }, [lang, map, busy, off]);
}

/** EN | עב — `night` for the pane's dark scheme. */
export function AdviceLangSwitch({ night = false }: { night?: boolean }) {
  const [lang, setLang] = useAdviceLang();
  const on = night ? "bg-[#1f2c57] text-foreground" : "bg-brand text-white";
  return (
    <div className={`inline-flex shrink-0 rounded-full p-0.5 text-[12px] ${night ? "bg-surface" : "bg-surface shadow-card"}`} role="group" aria-label="Language / שפה">
      {(["en", "he"] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`rounded-full px-2.5 py-1 font-medium ${lang === l ? on : "text-muted hover:text-foreground"}`}>
          {l === "en" ? "EN" : "עב"}
        </button>
      ))}
    </div>
  );
}
