"use client";

// `?viewAs=` is a PREVIEW. This is what makes that true.
//
// ⚠️ WHY THIS EXISTS. The shell has said "Viewing as X — preview only" since the
// feature shipped, but nothing enforced it: the store swaps the *displayed*
// `currentUserId` to the previewed member while the write actions keep the real
// signed-in id. So an admin previewing a designer who logged an hour wrote that
// hour to their OWN account — on a real client task, i.e. billable data
// attributed to the wrong person — and the Time Feed then hid it, because under
// `viewAs` `useIsAdmin()` is false and the feed forces its member filter to the
// previewed member. Found 2026-09-05: an hour logged while viewing as Nadav
// landed on Nitsan and was unreachable from every surface the preview showed.
//
// Attributing the write to the PREVIEWED member instead was the other option and
// is worse: it forges one person's timesheet from another's session.
//
// ⚠️ BLOCK BY DEFAULT. The allowlist below names what stays callable; every other
// function on the store is stubbed while a preview is on. That direction is
// deliberate — a NEW write method added later is guarded without anyone
// remembering this file, and the failure mode if we wrongly block a read is a
// visibly dead control on an admin-only surface, against silently mis-attributed
// hours the other way round.

import type { Store } from "./types";

/**
 * Store methods that stay live during a preview: reads, lazy loads, local-only
 * state patches and pure UI. Nothing here reaches Supabase with a write.
 *
 * ⚠️ FOUR OF THESE LOOK LIKE WRITES AND ARE NOT. `patchProfileLocal`,
 * `patchClientLocal`, `addAttachment` and `removeAttachment` are pure local
 * mirrors — each one only reflects a value an API ROUTE has ALREADY persisted
 * with the service key. Stubbing them cannot un-write anything; it just leaves
 * the UI disagreeing with the database.
 *
 * ⚠️ AND THE ATTACHMENT PAIR IS THE CASE THAT PROVES IT MATTERS, because
 * blocking half an operation is worse than blocking none of it. `task-panel.tsx`
 * removes the file locally and THEN calls `fetch(DELETE)`; the route authenticates
 * the real signed-in admin, so the row and the storage object are destroyed either
 * way. Stubbed, the notice claimed “preview only” while the file stayed on screen
 * and the attachment was gone for good — and attachments have no undo path.
 * The same is true in reverse for the upload. Found by the v1.50.4 code review.
 *
 * The residual is unchanged and is the one this guard cannot reach: an API route
 * writing with the service key authenticates from the SERVER session, so it is
 * outside the guard entirely. See the note at the top of this file.
 */
const PREVIEW_ALLOWED = new Set<keyof Store>([
  "briefLoaded",
  "openTask",
  "taskMinutes",
  "loadDayEntries",
  "loadCellEntries",
  "patchProfileLocal",
  "patchClientLocal",
  "addAttachment",
  "removeAttachment",
  "showNotice",
  "dismissNotice",
  "dismissWriteError",
  "refresh",
]);

/**
 * Return values for the two blocked methods whose "no" is not simply falsy.
 *
 * A generic stub returns a promise of null, which every other async caller
 * already reads as failure. These two don't: `groupTasksIntoNew` resolves to
 * null on SUCCESS and to a sentence explaining the refusal, and `markRequestSeen`
 * resolves to an object the caller reads `.ok` off — null would throw.
 */
const REFUSAL: Partial<Record<keyof Store, (reason: string) => unknown>> = {
  groupTasksIntoNew: (reason) => Promise.resolve(reason),
  markRequestSeen: (reason) => Promise.resolve({ ok: false, error: reason }),
};

/**
 * The store as a previewed member sees it: every write replaced by a no-op that
 * explains itself once, through the same neutral `notice` banner an expired undo
 * uses. `viewingAs` null returns the store untouched, so the normal path costs
 * nothing.
 */
export function guardPreview(store: Store, viewingAs: string | null): Store {
  if (!viewingAs) return store;
  const reason = `Preview only — leave “Viewing as ${viewingAs}” to make changes.`;
  const guarded = { ...store } as Record<string, unknown>;
  for (const key of Object.keys(store) as (keyof Store)[]) {
    if (typeof store[key] !== "function" || PREVIEW_ALLOWED.has(key)) continue;
    const refusal = REFUSAL[key];
    guarded[key as string] = () => {
      store.showNotice(reason);
      return refusal ? refusal(reason) : Promise.resolve(null);
    };
  }
  return guarded as unknown as Store;
}
