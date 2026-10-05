import { describe, expect, it } from "vitest";
import { bootFraction } from "./boot-progress";

describe("bootFraction", () => {
  it("starts at zero", () => {
    expect(bootFraction(0, 2000)).toBe(0);
  });

  it("reads about 80% when the boot takes as long as the last one", () => {
    expect(bootFraction(2000, 2000)).toBeGreaterThan(0.78);
    expect(bootFraction(2000, 2000)).toBeLessThan(0.84);
  });

  it("keeps creeping on a slow boot but never reaches 90% — the last 10% is the data landing", () => {
    const later = [1, 2, 4, 8].map((k) => bootFraction(2000 * k, 2000));
    for (let i = 1; i < later.length; i++) expect(later[i]).toBeGreaterThan(later[i - 1]);
    expect(later.at(-1)!).toBeLessThan(0.9);
  });
});
