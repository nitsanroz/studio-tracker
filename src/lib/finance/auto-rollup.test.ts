import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scheduler only — runRollup itself (the server action) is replaced, so
// nothing here reaches Supabase.
const runRollup = vi.fn();
vi.mock("@/lib/finance/actions", () => ({ runRollup: (...a: unknown[]) => runRollup(...a) }));

type Auto = typeof import("./auto-rollup");
const result = { monthsWritten: 1, gaps: [] };

/** A recompute that ends only when the test says so. */
function pending() {
  let finish: (v: typeof result) => void = () => {};
  const p = new Promise<typeof result>((res) => (finish = res));
  return { p, finish };
}

describe("the automatic P&L recompute", () => {
  let auto: Auto;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00+02:00"));
    vi.stubGlobal("window", new EventTarget());
    runRollup.mockReset();
    vi.resetModules();
    auto = await import("./auto-rollup");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs again when an edit lands during a recompute", async () => {
    const first = pending();
    runRollup.mockReturnValueOnce(first.p).mockResolvedValue(result);
    const opened = auto.refreshPnl();
    expect(runRollup).toHaveBeenCalledTimes(1);

    auto.schedulePnlRefresh();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(runRollup).toHaveBeenCalledTimes(1); // still the first one

    first.finish(result);
    await opened;
    await vi.runAllTimersAsync();
    expect(runRollup).toHaveBeenCalledTimes(2);
  });

  it("doesn't run again for a page opened during a recompute", async () => {
    const first = pending();
    runRollup.mockReturnValueOnce(first.p).mockResolvedValue(result);
    const opened = auto.refreshPnl();
    const second = auto.refreshPnl();
    first.finish(result);
    expect(await second).toBe(await opened);
    await vi.runAllTimersAsync();
    expect(runRollup).toHaveBeenCalledTimes(1);
  });

  it("asks for the year it runs in, not the year the tab opened in", async () => {
    runRollup.mockResolvedValue(result);
    await auto.refreshPnl();
    expect(runRollup).toHaveBeenLastCalledWith(2026, { auto: true });

    vi.setSystemTime(new Date("2027-01-02T09:00:00+02:00"));
    auto.schedulePnlRefresh();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(runRollup).toHaveBeenLastCalledWith(2027, { auto: true });
  });
});
