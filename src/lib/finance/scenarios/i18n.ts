// Scenarios in English or Hebrew (Nitsan, 2026-11-11: "allow the Scenarios
// page in Hebrew too, add a language switch"). English is the source: every
// string is written in English in the code and looked up in HE (he.ts) by that
// exact text; {name} marks fill in values. A string missing from HE shows in
// English — he.test.ts lists every t("…") in the page's files and fails on
// any without a Hebrew line.

// &all: one Hebrew lookup for the whole advisor — this map and &advice's
// (lib/advice/he-ui.ts `hebrew`), &advice's line first where both have one.
import { hebrew } from "@/lib/advice/he-ui";

export type Lang = "en" | "he";
export type Vars = Record<string, string | number>;

export interface T {
  (s: string, v?: Vars): string;
  lang: Lang;
}

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

export function tFor(lang: Lang): T {
  const t = ((s: string, v?: Vars) => fill(lang === "he" ? (hebrew(s) ?? s) : s, v)) as T;
  t.lang = lang;
  return t;
}

/** English — the default for the pure functions (and their tests). */
export const EN = tFor("en");

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  he: ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"],
};

/** "2026-11" → "Nov 26" / "נוב׳ 26". */
export const monthIn = (lang: Lang, ym: string) => `${MONTHS[lang][Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
