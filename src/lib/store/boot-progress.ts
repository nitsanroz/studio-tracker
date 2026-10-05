// Boot progress, 0–1, for the loading screen's bar.
//
// ⚠️ DELIBERATELY NOT STORE STATE. Boot reports ~30 times (once per page as it
// lands), and as a field on the store's context every report re-ran the whole
// DataProvider and rebuilt its 50-key value. A tiny external store read only by
// the loading screen costs one small re-render per report instead.

import { useSyncExternalStore } from "react";

let value = 0;
const listeners = new Set<() => void>();

export function setBootProgress(next: number) {
  // Whole percents only: the bar cannot show finer, so finer is wasted renders.
  const v = Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
  if (v === value) return;
  value = v;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBootProgress(): number {
  return useSyncExternalStore(subscribe, () => value, () => 0);
}
