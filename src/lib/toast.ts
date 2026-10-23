/**
 * Toasts — the "Playful" feedback picked 2026-10-23: a dark note slides up
 * from the bottom, its tick draws itself, an Undo sits beside it and a thin line
 * underneath counts down until it leaves on its own. Rendered by
 * `components/toaster.tsx` (mounted once in AppShell).
 *
 * A module, not a store slice: the store's write paths call `toast()` the same
 * way a component does, without either knowing about the other.
 *
 * ⚠️ `onUndo` UNDOES THAT ONE THING, never "the last action": by the time
 * somebody presses it they may have done something else, and the store's
 * history undo would then reverse the wrong change.
 */

export interface Toast {
  id: number;
  text: string;
  /** "done" draws the tick; "info" is a neutral note (the store's `showNotice`) */
  tone: "done" | "info";
  onUndo?: () => void;
  /** ms on screen — the countdown line runs for exactly this long */
  ms: number;
}

let list: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: { onUndo?: () => void; ms?: number; tone?: Toast["tone"] } = {}) {
  const t: Toast = { id: nextId++, text, tone: opts.tone ?? "done", onUndo: opts.onUndo, ms: opts.ms ?? 4000 };
  // Three at most: a burst of logs shouldn't build a tower up the screen.
  list = [...list, t].slice(-3);
  emit();
  setTimeout(() => dismissToast(t.id), t.ms);
}

export function dismissToast(id: number) {
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const getToasts = () => list;
const EMPTY: Toast[] = [];
export const getServerToasts = () => EMPTY;
