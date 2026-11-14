"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loadHold, loadPrivacy, moneyHostOf, PRIVACY_EVENT, saveHold } from "@/lib/finance/privacy";
import { PHONE_QUERY } from "@/lib/finance/use-phone";

/**
 * Discreet mode: after the configured idle time, stamps
 * `data-privacy="on"` on <html>; globals.css blurs all numeric content.
 * Any interaction (mouse, key, wheel, touch) lifts the blur and re-arms.
 *
 * Hold (the sidebar's "Hide numbers" switch) stamps `data-privacy="held"`
 * instead: on until switched off, whatever the mouse does, on a phone too —
 * and it hides only the DIGITS OF AMOUNTS: while held, a MutationObserver
 * stamps data-money-auto on every element showing one (see moneyHostOf), and
 * globals.css gives those the "Hidden Digits" font. Only an attribute is added
 * — React's text nodes are never touched.
 */
const AUTO = "data-money-auto";

function markText(node: Node) {
  const parent = node.parentElement;
  if (!parent || node.nodeType !== Node.TEXT_NODE) return;
  // The text just ahead: a sibling text node (`₪{rate}`), or — when this text
  // opens its element — the element before it (`<span>₪</span><span>1,234</span>`).
  let at: Node = node;
  for (let i = 0; i < 2 && !at.previousSibling && at.parentElement; i++) at = at.parentElement;
  const host = moneyHostOf((node as Text).data, parent, at.previousSibling?.textContent ?? "");
  if (host && !host.hasAttribute(AUTO)) host.setAttribute(AUTO, "");
}

/** An input holds an amount when the short label around it has a currency sign. */
function markInput(input: HTMLInputElement) {
  let el: Element | null = input.parentElement;
  for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
    const all = el.textContent ?? "";
    if (all.length > 80) return;
    if (/[₪$€]/.test(all)) return input.setAttribute(AUTO, "");
  }
}

function markTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return markText(root);
  if (!(root instanceof Element)) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) markText(n);
  if (root instanceof HTMLInputElement) markInput(root);
  root.querySelectorAll("input").forEach(markInput);
}

export function PrivacyBlur() {
  useEffect(() => {
    // Held: mark every amount now, and every one React renders from here on
    // (a hover card, a recomputed cell). Marks are cleared and redone on each
    // switch-on, so one left from earlier content can't linger.
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") markText(r.target);
        else r.addedNodes.forEach(markTree);
      }
    });
    let marking = false;
    const setMarking = (on: boolean) => {
      if (on === marking) return;
      marking = on;
      if (on) {
        document.querySelectorAll(`[${AUTO}]`).forEach((el) => el.removeAttribute(AUTO));
        markTree(document.body);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      } else {
        observer.disconnect();
      }
    };

    // Never on a phone: it's in the hand, and a blur there only gets in the
    // way. Re-checked as the window resizes, so a narrow desktop window that
    // widens gets its blur back. (Hold is asked for, so it applies there too.)
    const phone = window.matchMedia(PHONE_QUERY);
    let settings = loadPrivacy();
    let hold = loadHold();
    let timer: number | undefined;

    const setBlur = (on: boolean) => {
      document.documentElement.dataset.privacy = hold ? "held" : on ? "on" : "off";
    };
    const arm = () => {
      window.clearTimeout(timer);
      if (hold || !settings.enabled || phone.matches) return;
      timer = window.setTimeout(() => setBlur(true), settings.seconds * 1000);
    };
    const activity = () => {
      if (hold) return;
      setBlur(false);
      arm();
    };
    const refresh = () => {
      settings = loadPrivacy();
      hold = loadHold();
      setMarking(hold); // before the stamp, so no amount shows for a frame
      setBlur(false);
      arm();
    };

    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, activity, { passive: true });
    window.addEventListener(PRIVACY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    phone.addEventListener("change", refresh);
    refresh();

    return () => {
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, activity);
      window.removeEventListener(PRIVACY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      phone.removeEventListener("change", refresh);
      observer.disconnect();
      document.documentElement.dataset.privacy = "off";
    };
  }, []);

  return null;
}

/** The "Hide numbers" switch: keeps every figure blurred until pressed again —
 * for showing a page (Scenarios, a salary) to a colleague. A SWITCH, not a menu
 * row (Nitsan, 2026-11-12: as a row it read as one more page): a framed pill
 * with a track, at the sidebar's foot just above the user; brand blue while on,
 * so it's plain the screen is in that state. Folded, a framed icon. */
export function HideNumbersToggle({ folded = false, roomy = false }: { folded?: boolean; roomy?: boolean }) {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    const sync = () => setHold(loadHold());
    sync();
    window.addEventListener(PRIVACY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PRIVACY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const label = hold ? "Numbers hidden" : "Hide numbers";
  const Icon = hold ? EyeOff : Eye;
  const tone = hold
    ? "bg-brand text-white ring-brand hover:bg-brand-dark"
    : "bg-surface text-muted ring-border-strong hover:text-foreground";
  return (
    <button
      role="switch"
      aria-checked={hold}
      aria-label="Hide numbers"
      onClick={() => saveHold(!hold)}
      title={hold ? "Every number is blurred — press to show them" : "Blur every number until you switch it off"}
      className={`group/nav relative flex items-center rounded-full ring-1 transition-colors ${tone} ${
        folded ? "mx-auto size-9 justify-center" : `w-full gap-2 px-3 text-[13px] ${roomy ? "py-2.5" : "py-1.5"}`
      }`}
    >
      <Icon size={16} strokeWidth={1.9} />
      {!folded && (
        <>
          <span className="flex-1 text-start">{label}</span>
          <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${hold ? "bg-white/35" : "bg-border-strong"}`}>
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left] duration-150 ${hold ? "left-3.5" : "left-0.5"}`}
            />
          </span>
        </>
      )}
      {folded && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-white shadow-lg group-hover/nav:block">
          {label}
        </span>
      )}
    </button>
  );
}
