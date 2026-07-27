/**
 * Jewish holidays for a Gregorian date range, derived from the Hebrew calendar via
 * ICU (`Intl.DateTimeFormat` with `ca-hebrew`).
 *
 * Computed, not seeded. Hebrew dates drift against the Gregorian year, so a table
 * of literal dates would need re-seeding every year and would silently go stale the
 * moment nobody remembered to do it. This walks the range, asks ICU for each day's
 * Hebrew date, and matches against fixed Hebrew-calendar definitions — correct for
 * any year, forever, with no maintenance.
 *
 * Israel observance: one day of Sukkot/Pesach/Shavuot festival, and Simchat Torah on
 * Shemini Atzeret (22 Tishri) rather than the following day.
 */

export type Holiday = { date: string; title: string; icon: string };

/** Keyed "<ICU month name>-<day>". In a leap year ICU reports "Adar I"/"Adar II";
 *  in an ordinary year the single month is just "Adar" — hence both Purim keys. */
const FIXED: Record<string, { title: string; icon: string }> = {
  "Tishri-1": { title: "Rosh Hashanah", icon: "🍎" },
  "Tishri-2": { title: "Rosh Hashanah (day 2)", icon: "🍎" },
  "Tishri-10": { title: "Yom Kippur", icon: "🕍" },
  "Tishri-15": { title: "Sukkot", icon: "🌿" },
  "Tishri-22": { title: "Simchat Torah", icon: "📜" },
  "Kislev-25": { title: "Hanukkah (first candle)", icon: "🕎" },
  "Shevat-15": { title: "Tu BiShvat", icon: "🌳" },
  "Adar-14": { title: "Purim", icon: "🎭" },
  "Adar II-14": { title: "Purim", icon: "🎭" },
  "Nisan-15": { title: "Passover", icon: "🍷" },
  "Nisan-21": { title: "Passover (last day)", icon: "🍷" },
  "Iyar-18": { title: "Lag BaOmer", icon: "🔥" },
  "Iyar-28": { title: "Yom Yerushalayim", icon: "🕊️" },
  "Sivan-6": { title: "Shavuot", icon: "🌾" },
  "Av-9": { title: "Tisha B'Av", icon: "🕯️" },
};

const HEBREW = new Intl.DateTimeFormat("en-u-ca-hebrew", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function hebrewParts(d: Date): { month: string; day: number } {
  let month = "";
  let day = 0;
  for (const p of HEBREW.formatToParts(d)) {
    if (p.type === "month") month = p.value;
    else if (p.type === "day") day = Number(p.value);
  }
  return { month, day };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAY = 86400000;

/**
 * Yom HaShoah, Yom HaZikaron and Yom HaAtzmaut are the three that MOVE, so that
 * public observance never collides with Shabbat. Rules (Knesset, in force since 2004):
 *   Yom HaAtzmaut, 5 Iyar — Friday or Saturday → brought back to the preceding
 *     Thursday; Monday → pushed to Tuesday. Yom HaZikaron is always the day before.
 *   Yom HaShoah, 27 Nisan — Friday → back to Thursday; Sunday → on to Monday.
 * Everything else in FIXED sits on its Hebrew date unconditionally.
 */
function shifted(hebrewDate: Date, month: string, day: number): Holiday[] {
  const dow = hebrewDate.getUTCDay(); // 0 Sun … 6 Sat

  if (month === "Nisan" && day === 27) {
    let d = hebrewDate;
    if (dow === 5) d = new Date(d.getTime() - DAY); // Fri → Thu
    else if (dow === 0) d = new Date(d.getTime() + DAY); // Sun → Mon
    return [{ date: iso(d), title: "Yom HaShoah", icon: "🕯️" }];
  }

  if (month === "Iyar" && day === 5) {
    let d = hebrewDate;
    if (dow === 5) d = new Date(d.getTime() - DAY); // Fri → Thu
    else if (dow === 6) d = new Date(d.getTime() - 2 * DAY); // Sat → Thu
    else if (dow === 1) d = new Date(d.getTime() + DAY); // Mon → Tue
    return [
      { date: iso(new Date(d.getTime() - DAY)), title: "Yom HaZikaron", icon: "🕯️" },
      { date: iso(d), title: "Yom HaAtzmaut", icon: "🇮🇱" },
    ];
  }

  return [];
}

/** Holidays falling between `from` and `to` (inclusive, "YYYY-MM-DD"), date-sorted.
 *  A shifted holiday can land just outside the window; it's kept only if in range. */
export function jewishHolidays(from: string, to: string): Holiday[] {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const out: Holiday[] = [];

  // Walk a couple of days wide so a holiday shifted INTO the window isn't missed.
  for (let t = start.getTime() - 2 * DAY; t <= end.getTime() + 2 * DAY; t += DAY) {
    const d = new Date(t);
    const { month, day } = hebrewParts(d);

    const fixed = FIXED[`${month}-${day}`];
    if (fixed) out.push({ date: iso(d), ...fixed });
    out.push(...shifted(d, month, day));
  }

  return out
    .filter((h) => h.date >= from && h.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}
