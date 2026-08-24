import { startOfWeek, toISODate } from "./format";

export const RANGE_PRESETS = [
  "This week",
  "Last week",
  "This month",
  "Last month",
  "This year",
  "Last year",
  "Custom",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Israeli work week: Sunday–Saturday. Returns inclusive ISO date range. */
export function presetRange(preset: RangePreset, now = new Date()): { from: string; to: string } {
  // `startOfWeek` rather than the same arithmetic inline: two definitions of "the
  // Israeli week starts on Sunday" is how one of them silently keeps the old rule.
  const startOfThisWeek = startOfWeek(now);
  switch (preset) {
    case "This week": {
      const end = new Date(startOfThisWeek);
      end.setDate(end.getDate() + 6);
      return { from: toISODate(startOfThisWeek), to: toISODate(end) };
    }
    case "Last week": {
      const start = new Date(startOfThisWeek);
      start.setDate(start.getDate() - 7);
      const end = new Date(startOfThisWeek);
      end.setDate(end.getDate() - 1);
      return { from: toISODate(start), to: toISODate(end) };
    }
    case "This month":
      return {
        from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "Last month":
      return {
        from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "This year":
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    case "Last year":
      return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
    case "Custom":
      return { from: toISODate(startOfThisWeek), to: toISODate(now) };
  }
}
