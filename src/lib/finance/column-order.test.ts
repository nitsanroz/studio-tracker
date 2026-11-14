import { describe, expect, it } from "vitest";
import { mergeOrder, moveKey } from "./column-order";

describe("column order", () => {
  const defaults = ["a", "b", "c", "d"];

  it("keeps a saved order, drops columns that are gone, places new ones after their default neighbour", () => {
    expect(mergeOrder(null, defaults)).toEqual(defaults);
    expect(mergeOrder(["c", "a", "b", "d"], defaults)).toEqual(["c", "a", "b", "d"]);
    expect(mergeOrder(["d", "x", "a"], defaults)).toEqual(["d", "a", "b", "c"]);
    expect(mergeOrder(["b", "a"], ["new", "a", "b"])).toEqual(["new", "b", "a"]);
    expect(mergeOrder(["a", "a", "b", "c", "d"], defaults)).toEqual(defaults);
  });

  it("a dropped column takes the target's place", () => {
    expect(moveKey(defaults, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveKey(defaults, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveKey(defaults, "a", "a")).toEqual(defaults);
    expect(moveKey(defaults, "a", "zz")).toEqual(defaults);
  });
});
