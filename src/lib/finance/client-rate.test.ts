import { describe, expect, it } from "vitest";
import { rateAfterDelete } from "./client-rate";
import type { ClientRate } from "./finance";

const r = (rate: number, effectiveFrom: string, effectiveTo: string | null = null): ClientRate => ({
  clientId: "c1",
  clientCanon: "Acme",
  rate,
  effectiveFrom,
  effectiveTo,
});
const months = [...Array(12)].map((_, i) => i + 1);

describe("rateAfterDelete", () => {
  it("falls back to the earlier rate in the months the deleted one priced", () => {
    const old = r(300, "2025-01-01");
    const gone = r(350, "2026-05-01");
    const back = months.map((m) => rateAfterDelete([old], gone, 2026, m));
    expect(back).toEqual([null, null, null, null, 300, 300, 300, 300, 300, 300, 300, 300]);
  });

  it("leaves a later rate's months alone (a backdated rate is deleted)", () => {
    const later = r(400, "2026-09-01");
    const gone = r(350, "2026-03-01");
    const touched = months.filter((m) => rateAfterDelete([later], gone, 2026, m) != null);
    expect(touched).toEqual([3, 4, 5, 6, 7, 8]);
    expect(rateAfterDelete([later], gone, 2026, 3)).toBe(0); // nothing left before September
  });

  it("a rate starting after the 15th didn't price its first month", () => {
    expect(rateAfterDelete([r(300, "2025-01-01")], r(350, "2026-04-20"), 2026, 4)).toBeNull();
    expect(rateAfterDelete([r(300, "2025-01-01")], r(350, "2026-04-20"), 2026, 5)).toBe(300);
  });

  it("deleting one of two identical rows changes nothing's price", () => {
    const twin = r(350, "2026-01-01");
    expect(months.map((m) => rateAfterDelete([twin], r(350, "2026-01-01"), 2026, m))).toEqual(months.map(() => 350));
  });

  it("a rate that ended before the year prices none of it", () => {
    const gone = r(250, "2024-01-01", "2025-06-30");
    expect(months.filter((m) => rateAfterDelete([r(300, "2025-07-01")], gone, 2026, m) != null)).toEqual([]);
  });
});
