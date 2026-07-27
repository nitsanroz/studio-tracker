/**
 * "Studio & fun days" — a small curated set of fixed-date days worth a nod on the
 * home page. Design-forward, with a couple of food days.
 *
 * These are plain Gregorian month/day, so unlike the Jewish holidays they need no
 * calendar conversion: they're emitted as recurring "MM-DD" occasions and the home
 * pane's existing roll-to-next-year logic handles them.
 *
 * Deliberately short. A pane listing every "national sandwich day" stops being
 * information and becomes noise — the studio asked for restraint. Only
 * widely-recognised days are included; ones with competing claims (pizza day is
 * 9 Feb in the US but 17 Jan internationally) are left out rather than guessed at.
 *
 * Roughly spread March–October; September and December are already well covered by
 * the Jewish holidays.
 */

export type StudioDay = { monthDay: string; title: string; icon: string };

export const STUDIO_DAYS: StudioDay[] = [
  { monthDay: "03-08", title: "International Women's Day", icon: "✊" },
  { monthDay: "04-27", title: "World Design Day", icon: "🎨" },
  { monthDay: "05-13", title: "International Hummus Day", icon: "🥙" },
  { monthDay: "06-12", title: "International Falafel Day", icon: "🧆" },
  { monthDay: "07-17", title: "World Emoji Day", icon: "😀" },
  { monthDay: "08-19", title: "World Photography Day", icon: "📷" },
  { monthDay: "10-01", title: "International Coffee Day", icon: "☕" },
  { monthDay: "10-25", title: "International Artist's Day", icon: "🖌️" },
];
