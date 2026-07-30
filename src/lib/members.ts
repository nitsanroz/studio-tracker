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
