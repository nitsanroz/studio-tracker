// Boot progress, 0–1, for the loading screen's bar.
//
// ⚠️ DELIBERATELY NOT STORE STATE. The bar moves ~10 times a second, and as a
// field on the store's context every move re-ran the whole DataProvider and
// rebuilt its 50-key value. A tiny external store read only by the loading
// screen costs one small re-render per move instead.
//
// ⚠️ AN ESTIMATE FROM THE LAST BOOT, NOT A COUNT OF ROWS. It counted pages
// until v1.68.0, when the time-entry history became one packed call (0051) —
// a single response has no pages, so a row count would sit still and then
// jump. The bar now runs against how long the previous boot on this device
// took, eases toward 90% so a slower boot never stalls it dead, and jumps to
// 100% only when the data is actually in.

import { useSyncExternalStore } from "react";

let value = 0;
const listeners = new Set<() => void>();

function setBootProgress(next: number) {
  // Whole percents only: the bar cannot show finer, so finer is wasted renders.
  const v = Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
  if (v === value) return;
  value = v;
  listeners.forEach((l) => l());
}

const LAST_BOOT_KEY = "boot.ms";
const DEFAULT_MS = 2500;

/** Where the bar should be after `elapsed` ms of a boot expected to take `expected`. */
export function bootFraction(elapsed: number, expected: number): number {
  // 1 − e^(−2.3t) reaches ~90% of its ceiling at t = 1, i.e. the bar reads ~81%
  // when the boot is as long as the last one and keeps creeping after that.
  return 0.9 * (1 - Math.exp((-2.3 * elapsed) / expected));
}

/**
 * Starts the bar. `done()` once the data is applied (records how long this
 * boot took, for the next one); `stop()` when the boot is abandoned — an
 * unmount or a failure — so the timer never outlives it.
 */
export function startBootProgress(): { done: () => void; stop: () => void } {
  let expected = DEFAULT_MS;
  try {
    const saved = Number(localStorage.getItem(LAST_BOOT_KEY));
    if (saved > 0) expected = Math.min(15_000, Math.max(800, saved));
  } catch {
    // private window — use the default
  }
  const t0 = performance.now();
  setBootProgress(0);
  const timer = setInterval(() => setBootProgress(bootFraction(performance.now() - t0, expected)), 100);
  const stop = () => clearInterval(timer);
  return {
    stop,
    done: () => {
      stop();
      try {
        localStorage.setItem(LAST_BOOT_KEY, String(Math.round(performance.now() - t0)));
      } catch {
        // private window — the next boot uses the default
      }
      setBootProgress(1);
    },
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBootProgress(): number {
  return useSyncExternalStore(subscribe, () => value, () => 0);
}
