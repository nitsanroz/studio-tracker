// ⚠️ SERVER ONLY — personal details. Never import this from client code:
// finance-leak-guard.test.ts fails if a browser bundle reaches it.
//
// What the owner calls people when naming a scenario. The Scenarios advisor
// swaps every person's name for initials + a ref before anything is sent to
// Claude (advise-prompt.ts `briefOf`), and a nickname has to be swapped too.
// The Scenarios layout hands this to the owner's page after its tier check
// (useCompanyFigures().nicknames), so it is in no file a member can download.

/** nickname → the person's first name in the tracker, lower case. */
export const NICKNAMES: Record<string, string> = {
  katie: "ekaterina",
  melissa: "milica",
  dima: "dmitry",
  // Hebrew spellings, for scenario names written on the Hebrew page.
  "קייטי": "ekaterina",
  "קטיה": "ekaterina",
  "מליסה": "milica",
  "מיליצה": "milica",
  "דימה": "dmitry",
  "נדב": "nadav",
  "אקי": "aki",
  "שקד": "shaked",
  "מיכל": "michal",
  "ניצן": "nitsan",
};
