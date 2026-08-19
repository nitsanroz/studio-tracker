/**
 * Add `v` to the list, or drop it if already there — the "is this in the set"
 * state pattern the report toolbars use for folded sections, hidden columns and
 * hidden task ids. Written inline four times before; the point of naming it is
 * that all four now read as the same operation.
 */
export function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
