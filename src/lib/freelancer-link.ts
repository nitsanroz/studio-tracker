// A freelancer's private link (0054): /log/<first-name>-<secret>, e.g.
// /log/abolfazi-Xa82kQ… — his name so the link reads as his, the secret so it
// can't be guessed. The secret is letters and digits only (no "-"), so it is
// always the part after the LAST dash; the name part is never trusted.

/** A link's secret part: the segment after the last dash (or all of it, for a
 * link minted before names were added). */
export function tokenFromSegment(segment: string): string {
  const s = decodeURIComponent(segment);
  return /^[A-Za-z0-9_-]{24,}$/.test(s) && !/^[a-z0-9]+-[A-Za-z0-9]{24,}$/.test(s) ? s : s.slice(s.lastIndexOf("-") + 1);
}

/** "Abolfazi Babaei" → "abolfazi" — the readable part of his link. */
export function linkSlug(name: string): string {
  return (
    name
      .split(" ")[0]
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "freelancer"
  );
}

/** The path of his page. */
export const freelancerPath = (name: string, token: string) => `/log/${linkSlug(name)}-${token}`;
