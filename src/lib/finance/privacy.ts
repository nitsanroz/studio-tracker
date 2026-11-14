// Discreet mode: blur all on-screen numbers after N idle seconds.
// Device-local (localStorage) — not synced to the database.

export interface PrivacySettings {
  enabled: boolean;
  seconds: number;
}

export const PRIVACY_KEY = "finance-privacy-blur";
/** Fired on window after savePrivacy so the idle watcher re-reads settings. */
export const PRIVACY_EVENT = "privacy-settings-changed";

export const DEFAULT_PRIVACY: PrivacySettings = { enabled: true, seconds: 5 };

/** What savePrivacy couldn't store (blocked storage): it holds for this visit. */
let unsaved: PrivacySettings | null = null;

export function loadPrivacy(): PrivacySettings {
  if (typeof window === "undefined") return DEFAULT_PRIVACY;
  if (unsaved) return unsaved;
  try {
    const raw = localStorage.getItem(PRIVACY_KEY);
    if (!raw) return DEFAULT_PRIVACY;
    const p = JSON.parse(raw) as Partial<PrivacySettings>;
    const seconds = Number(p.seconds);
    return {
      enabled: p.enabled ?? DEFAULT_PRIVACY.enabled,
      seconds: Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds) : DEFAULT_PRIVACY.seconds,
    };
  } catch {
    return DEFAULT_PRIVACY;
  }
}

export function savePrivacy(s: PrivacySettings): void {
  // Blocked storage (private window, site data off) throws: the setting then
  // lasts this visit only.
  try {
    localStorage.setItem(PRIVACY_KEY, JSON.stringify(s));
    unsaved = null;
  } catch {
    unsaved = s;
  }
  window.dispatchEvent(new Event(PRIVACY_EVENT));
}

// ── Hold: blur on until switched off ─────────────────────────────────────────
// The sidebar's "Hide numbers" switch (Nitsan, 2026-11-12: show Scenarios to a
// colleague without showing salaries). Unlike the idle blur, moving the mouse
// doesn't lift it, it covers hover cards and the phone too, and it survives a
// reload — so refreshing mid-share can't reveal anything. Device-local.

export const PRIVACY_HOLD_KEY = "finance-privacy-hold";

/** What saveHold couldn't store (blocked storage): it holds for this visit. */
let unsavedHold: boolean | null = null;

export function loadHold(): boolean {
  if (typeof window === "undefined") return false;
  if (unsavedHold !== null) return unsavedHold;
  try {
    return localStorage.getItem(PRIVACY_HOLD_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHold(on: boolean): void {
  try {
    if (on) localStorage.setItem(PRIVACY_HOLD_KEY, "1");
    else localStorage.removeItem(PRIVACY_HOLD_KEY);
    unsavedHold = null;
  } catch {
    unsavedHold = on;
  }
  window.dispatchEvent(new Event(PRIVACY_EVENT));
}

// ── Which figures are amounts ────────────────────────────────────────────────
// Hide numbers hides money only (Nitsan, 2026-11-12) — dates, years, hours and
// percentages stay readable. Every amount the app prints carries ₪ (formatILS
// and friends) or $/€; the few grids that don't are marked data-money in code.

const CURRENCY = /[₪$€]/;

/** True when a piece of text is an amount, or a sentence holding one. */
export function isMoneyText(text: string): boolean {
  return CURRENCY.test(text) && /\d/.test(text);
}

/** A whole text that is one amount and nothing else: "₪1,234", "-₪12.5K", "40 €". */
const ONE_AMOUNT = /^\s*[-+−]?\s*(?:[₪$€]\s*[-−]?[\d.,]+\s*[KkMm]?|[\d.,]+\s*[KkMm]?\s*[₪$€])\s*(?:\/h)?\s*$/;

/** The element to mark for a text node holding digits: its own element when
 * the text has a currency sign; else the nearest of the next two ancestors
 * whose whole text is ONE amount — "₪" and "1,234" in sibling spans. Never a
 * row or a card that merely contains an amount somewhere (that hid the year
 * and margin beside it). `before` is the text just ahead of this one in the
 * same element: React renders `₪{rate}/h` as three text nodes, so the number
 * itself carries no sign. */
export function moneyHostOf(text: string, parent: Element, before = ""): Element | null {
  if (!/\d/.test(text)) return null;
  if (CURRENCY.test(text) || /[₪$€]\s*[-−]?\s*$/.test(before)) return parent;
  let el: Element | null = parent;
  for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
    const all = el.textContent ?? "";
    if (all.length > 40) return null;
    if (ONE_AMOUNT.test(all)) return el;
  }
  return null;
}
