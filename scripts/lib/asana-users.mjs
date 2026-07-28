/**
 * Asana comment author → tracker profile.
 *
 * Shared by reconcile-legacy-hours.mjs and build-rehome-sql.mjs, which MUST
 * agree: the reconciler decides how many hours are "attributable" and therefore
 * how much lands in `tasks.legacy_hours` as the remainder, while the SQL
 * generator decides which entries actually get inserted. If the two used
 * different matching, the invariant
 *
 *     task total = Σ(legacy time_entries) + legacy_hours
 *
 * would silently break — hours would be double-counted or dropped.
 *
 * Most pre-Everhour comment authors are people who left the studio years before
 * the current roster (yam sasson, Edor Nisim, Miri Kuntsman, adi, ruth, dikla…):
 * 2,175 of 2,397 comments. They have no profile and cannot get a time entry,
 * because `time_entries.user_id` is NOT NULL. Their hours stay in the remainder.
 */

/** Asana user gid → studio email. Same table as scripts/enrich-asana.mjs. */
export const ASANA_USERS = {
  "1213133403131729": "adaya@studionmore.com",
  "1210682630033814": "aki@studionmore.com",
  "1178236968554591": "daniel@studionmore.com",
  "1213352178360044": "dima@studionmore.com",
  "1213676397334342": "itay.b@studionmore.com",
  "1208980808187472": "itay.c@studionmore.com",
  "1215769288616159": "leeyam@studionmore.com",
  "1206858324797116": "liza@studionmore.com",
  "1212644471173780": "michal@studionmore.com",
  "1207503684349891": "nadav.h@studionmore.com",
  "119644861961683": "nitsan@studionmore.com",
  "1202732458183440": "shnitz@studionmore.com",
  "1213991315479067": "sefi@studionmore.com",
  "1201675320609741": "sofia@studionmore.com",
  "1203432225207168": "peter@studionmore.com",
  "366074454182724": "office@studionmore.com",
};

const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * @param {{id:string,name:string}[]} profiles
 * @returns {(story:{created_by?:{gid?:string,name?:string}}) => string|null}
 *   Resolver returning a profile id, or null when the author has no profile.
 */
export function makeAuthorResolver(profiles) {
  const byName = new Map(profiles.map((p) => [norm(p.name), p.id]));
  // Emails aren't on `profiles` (they live in auth.users), so the ASANA_USERS
  // table is bridged by first name — enough to be unambiguous for this roster.
  const byGid = new Map();
  for (const [gid, email] of Object.entries(ASANA_USERS)) {
    const first = email.split("@")[0].split(".")[0];
    const hit = profiles.find((p) => norm(p.name).split(" ")[0] === first);
    if (hit) byGid.set(gid, hit.id);
  }

  return (story) => {
    const gid = story?.created_by?.gid;
    if (gid && byGid.has(gid)) return byGid.get(gid);
    const name = norm(story?.created_by?.name);
    return name ? (byName.get(name) ?? null) : null;
  };
}
