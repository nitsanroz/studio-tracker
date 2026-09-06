import { describe, expect, it, vi } from "vitest";
import { guardPreview } from "./preview-guard";
import type { Store } from "./types";

// The failure this guards against is silent and lands in billable data: an hour
// logged while previewing a designer was written to the ADMIN's account and then
// hidden by the preview's own member filter. So the assertions below are about
// the write never reaching the real method — not about the notice text.

/** A stand-in store: one blocked write, one allowlisted read, one plain value. */
function fakeStore(over: Record<string, unknown> = {}) {
  return {
    addTimeEntry: vi.fn(),
    deleteTimeEntry: vi.fn(),
    openTask: vi.fn(),
    patchProfileLocal: vi.fn(),
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    showNotice: vi.fn(),
    groupTasksIntoNew: vi.fn(),
    markRequestSeen: vi.fn(),
    profiles: [{ id: "p1" }],
    currentUserId: "p1",
    ...over,
  } as unknown as Store;
}

describe("guardPreview", () => {
  it("returns the store untouched when no preview is on", () => {
    const store = fakeStore();
    expect(guardPreview(store, null)).toBe(store);
  });

  it("stops a write from reaching the real method", () => {
    const store = fakeStore();
    guardPreview(store, "Nadav").addTimeEntry("t1", 60, "test");
    expect(store.addTimeEntry).not.toHaveBeenCalled();
  });

  it("says why, once, through the neutral notice banner", () => {
    const store = fakeStore();
    guardPreview(store, "Nadav").deleteTimeEntry("e1");
    expect(store.showNotice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.showNotice).mock.calls[0][0]).toContain("Nadav");
  });

  it("leaves reads and pure UI callable", () => {
    const store = fakeStore();
    const guarded = guardPreview(store, "Nadav");
    guarded.openTask("t1");
    guarded.patchProfileLocal("p1", { name: "x" });
    expect(store.openTask).toHaveBeenCalledWith("t1");
    expect(store.patchProfileLocal).toHaveBeenCalled();
  });

  // ⚠️ THE REGRESSION THIS PINS: these two are pure local mirrors of a write an
  // API route has already made, and `task-panel.tsx` calls them RIGHT BEFORE its
  // own fetch. Stubbing them blocked half the operation — the notice said
  // "preview only" while the DELETE went through and destroyed the row and the
  // storage object, leaving the file on screen with no undo path.
  it("leaves the attachment mirrors callable, so a preview cannot block half a delete", () => {
    const store = fakeStore();
    const guarded = guardPreview(store, "Nadav");
    guarded.addAttachment({ id: "a1" } as never);
    guarded.removeAttachment("a1");
    expect(store.addAttachment).toHaveBeenCalled();
    expect(store.removeAttachment).toHaveBeenCalledWith("a1");
    expect(store.showNotice).not.toHaveBeenCalled();
  });

  it("passes non-function values straight through", () => {
    const store = fakeStore();
    const guarded = guardPreview(store, "Nadav");
    expect(guarded.profiles).toBe(store.profiles);
    expect(guarded.currentUserId).toBe("p1");
  });

  // Block-by-default is the point: a write added to the store later must be
  // guarded without anyone remembering this file exists.
  it("blocks a method it has never heard of", () => {
    const invented = vi.fn();
    const store = fakeStore({ deleteEverything: invented });
    (guardPreview(store, "Nadav") as unknown as Record<string, () => void>).deleteEverything();
    expect(invented).not.toHaveBeenCalled();
  });

  // The generic stub resolves to null, which every other async caller already
  // reads as failure. These two do not — see REFUSAL in the implementation.
  it("refuses groupTasksIntoNew with a sentence, not a null that reads as success", async () => {
    const store = fakeStore();
    const result = await guardPreview(store, "Nadav").groupTasksIntoNew(["t1"], "Group");
    expect(result).toBeTypeOf("string");
    expect(store.groupTasksIntoNew).not.toHaveBeenCalled();
  });

  it("refuses markRequestSeen with an object the caller can read .ok off", async () => {
    const store = fakeStore();
    const result = await guardPreview(store, "Nadav").markRequestSeen("r1");
    expect(result.ok).toBe(false);
    expect(store.markRequestSeen).not.toHaveBeenCalled();
  });
});
