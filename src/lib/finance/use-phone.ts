"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `md` breakpoint — the phone layout. One definition for
 * every component that behaves differently on a phone. */
export const PHONE_QUERY = "(max-width: 767px)";

// One shared media query, so any number of components can ask cheaply.
let mq: MediaQueryList | null = null;
const query = () => (mq ??= window.matchMedia(PHONE_QUERY));
const subscribe = (onChange: () => void) => {
  query().addEventListener("change", onChange);
  return () => query().removeEventListener("change", onChange);
};

/** True on a phone-width screen, kept current as the window resizes
 * (false while rendering on the server). */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => query().matches, () => false);
}
