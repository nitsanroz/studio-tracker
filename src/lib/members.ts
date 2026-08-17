import type { Profile } from "./types";

/**
 * Members a time entry may be attributed to, for the admin "log for someone
 * else" pickers.
 *
 * Excludes accountless profiles: since migration 0018 a profile is a *person*,
 * and the ~24 former staff kept for historical attribution have no login and
 * must never appear in a picker (the CHECK also forces them inactive).
 *
 * `meFirstId` floats the signed-in user to the top and is expected to render as
 * "Me" — sorting them by real name buried the default option mid-list.
 */
export function loggableMembers(profiles: Profile[], meFirstId?: string | null): Profile[] {
  return profiles
    .filter((p) => p.active && p.hasAccount !== false)
    .sort((a, b) =>
      a.id === meFirstId ? -1 : b.id === meFirstId ? 1 : a.name.localeCompare(b.name),
    );
}

/**
 * How many minutes a full working day is FOR THIS PERSON — the denominator of
 * every "3h / 8h" readout.
 *
 * It is a person's weekly capacity over the studio's five working days, not a
 * flat eight hours: a part-timer on 20h a week owes 4h, and telling them they
 * are half way through a day when they have finished it is worse than showing
 * no target at all. Lifted out of `DayLog`, which had it inline, because the
 * phone's log-time sheet now shows the same figure and two expressions of one
 * rule is how they come to disagree.
 */
export function dailyTargetMinutes(profile: Profile | null | undefined): number {
  return profile?.capacityHoursWeek ? (profile.capacityHoursWeek / 5) * 60 : 8 * 60;
}
