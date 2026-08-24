/**
 * Which default cut-out portrait to draw for a member, from the free-text
 * `member_hr.gender` value.
 *
 * ⚠️ EXACT TOKENS, NEVER SUBSTRINGS — "female" CONTAINS "male", so an `includes`
 * check answers every woman in the studio with the man's portrait. That is the
 * one bug this file exists to make impossible, and it is why the sets below are
 * compared against the whole normalised string.
 *
 * ⚠️ The column is free text seeded from a spreadsheet, so the vocabulary is
 * whatever was typed — English and Hebrew both, in either direction. Anything not
 * listed returns **null**, and the caller falls back to the neutral cut-out.
 * Guessing is the one thing not on the table: a name is not a statement about
 * anyone's gender, and a wrong portrait is worse than a neutral one.
 */
export type AvatarVariant = "man" | "woman";

const MAN = new Set(["m", "male", "man", "boy", "זכר", "גבר", "ז"]);
const WOMAN = new Set(["f", "female", "w", "woman", "girl", "נקבה", "אישה", "אשה", "נ"]);

export function avatarVariantFor(raw: string | null | undefined): AvatarVariant | null {
  if (!raw) return null;
  // Trim, lower-case, and drop the punctuation a hand-filled sheet collects.
  const v = raw.trim().toLowerCase().replace(/[.\s]+$/, "");
  if (MAN.has(v)) return "man";
  if (WOMAN.has(v)) return "woman";
  return null;
}
