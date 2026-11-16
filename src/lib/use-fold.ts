"use client";

import { useSyncExternalStore } from "react";

// Whether a side panel is open, remembered per browser (localStorage `fold.<key>`
// = "0" when folded). Open by default, and on the server. Every panel with a
// fold button uses it, so they all behave the same (Nitsan, 2026-11-15: "a
// clear, prominent button to fold and open whenever there is a panel at the side").

const EVENT = "fold:change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useFold(key: string): [boolean, () => void] {
  const name = `fold.${key}`;
  const open = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(name) !== "0";
      } catch {
        return true;
      }
    },
    () => true,
  );
  const toggle = () => {
    try {
      window.localStorage.setItem(name, open ? "0" : "1");
    } catch {
      /* blocked storage: it lasts until the page is left */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [open, toggle];
}
