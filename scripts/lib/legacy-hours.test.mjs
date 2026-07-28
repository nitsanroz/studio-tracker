/**
 * Cases are REAL strings from the Imported / Unsorted data. Everything marked
 * "prototype bug" is a row an earlier, simpler parser got wrong.
 *   node --test scripts/lib/legacy-hours.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseLegacyName, parseCommentHours } from "./legacy-hours.mjs";

const cases = [
  // title, expected {budget, budgetMax, actual, clean, closedOn}
  ["Kick off meeting - 2h", { budget: null, actual: 2, clean: "Kick off meeting" }],
  ["Logo Update (8) - 5.25h", { budget: 8, actual: 5.25, clean: "Logo Update" }],
  ["Website Wireframes (32-42) - 16.75h", { budget: 32, budgetMax: 42, actual: 16.75 }],
  // prose parens must SURVIVE the clean; only figure parens are stripped
  [
    "Homepage Design (Graphic Language) (64) - 64h",
    { budget: 64, actual: 64, clean: "Homepage Design (Graphic Language)" },
  ],
  [
    "עמוד פנימי מרכז למידה (כתבה) - 6-8",
    { budget: 6, budgetMax: 8, actual: null, clean: "עמוד פנימי מרכז למידה (כתבה)" },
  ],
  [
    "מחשבון (תלוי מאוד ברמת ההשקעה שיירצו) - 8-12",
    { budget: 8, budgetMax: 12, clean: "מחשבון (תלוי מאוד ברמת ההשקעה שיירצו)" },
  ],
  ["Business card (temporary) - 4h", { actual: 4, clean: "Business card (temporary)" }],
  ["Leg2 & Referral pages dev (92h & 64h & 40h)", { clean: "Leg2 & Referral pages dev" }],
  ["Full Website Design (105-146- final 200.5) - 200.5h", { budget: 200.5, actual: 200.5 }],
  ["Wordpress (100)", { budget: 100, actual: null, clean: "Wordpress" }],
  ["Testemonials Page (8-10)", { budget: 8, budgetMax: 10, actual: null }],
  ["Design (70)- 50h  ", { budget: 70, actual: 50, clean: "Design" }],
  ["Careers page (20h)-28h", { budget: 20, actual: 28, clean: "Careers page" }],
  ["QA (5h) 8.75h", { budget: 5, actual: 8.75, clean: "QA" }],
  ["Login/ sign in pages (16h) - ", { budget: 16, actual: null }],
  ["LinkedIn cover for employees-1.75h", { actual: 1.75 }],
  ["Volta modular page (16h + 15h dev) - 8+15h", { budget: 31, actual: 23 }],

  // prototype bug: greedy range ate the actual
  ["אינטרקציית מפה 2-3 - 1.5", { budget: 2, budgetMax: 3, actual: 1.5 }],
  ["גרפים במחשבון 6-8 - 8", { budget: 6, budgetMax: 8, actual: 8 }],
  // a bare trailing range is a budget, NOT an actual
  ["פרטי - 8-10", { budget: 8, budgetMax: 10, actual: null }],

  // prototype bug: these were read as hours
  ["404 basic page", { budget: null, actual: null, clean: "404 basic page" }],
  ["Animation corrections for 1 video - 2h", { actual: 2 }],
  ["November 2022", { budget: null, actual: null, clean: "November 2022" }],
  ["Leg2", { budget: null, actual: null, clean: "Leg2" }],

  // sections
  // prototype bug: trailing date blocked the actual
  ["Movies - 171.75h (2/5/21)", { actual: 171.75, clean: "Movies", closedOn: "2021-05-02" }],
  ["Development -88h (31/1/21)", { actual: 88, clean: "Development", closedOn: "2021-01-31" }],
  // prototype bug: the trailing "2" was stripped out of the name
  ["Leg 2 (181h) - 150.75h", { budget: 181, actual: 150.75, clean: "Leg 2" }],
  // prototype bug: summed to 540 instead of taking the "=270" total
  ["3D work (110+80+16+64=270) - 412.5 (2/5/2021)", { budget: 270, actual: 412.5 }],
  ["Website (40 hours from client + 40 = 80) - 90.5h", { budget: 80, actual: 90.5 }],
  // prototype bug: "- FINAL" hid the actual
  ["Branding (8) - 7.25 (1/9/2020ׁ) - FINAL", { budget: 8, actual: 7.25, clean: "Branding" }],
  ["Website (232+61/134) (Total 293-366) - 388.5 (27/1/2021)", { actual: 388.5, clean: "Website" }],
  ["Yoco new website - 67h (26/06/22)", { actual: 67, clean: "Yoco new website" }],
  ["Development (100) - 100", { budget: 100, actual: 100, clean: "Development" }],
  ["3D & Animation", { budget: null, actual: null, clean: "3D & Animation" }],

  // "hrs"/"hours" spelled out — as common as "h" on the older boards, and an
  // actual-regex anchored on a bare trailing "h" skipped every one.
  ["Presentation case study 1 - 24hrs", { actual: 24, clean: "Presentation case study 1" }],
  ["Ui system - 165hrs", { actual: 165, clean: "Ui system" }],
  ["Kickoff - 3 hours", { actual: 3, clean: "Kickoff" }],

  // A month-and-year name followed by the actual. "19 - 90" was being read as
  // the budget RANGE 19–90, losing the 90h entirely. A real range's dash is
  // tight ("2-3"); this one has spaces.
  ["Feb 19 - 90h", { budget: null, actual: 90, clean: "Feb 19" }],
  ["March 19 - 85.75h", { budget: null, actual: 85.75, clean: "March 19" }],
  // …while a genuine tight range still reads as a range.
  ["מסחרי - 6-8", { budget: 6, budgetMax: 8, actual: null, clean: "מסחרי" }],
];

for (const [input, want] of cases) {
  test(JSON.stringify(input), () => {
    const got = parseLegacyName(input);
    for (const [k, v] of Object.entries(want)) {
      assert.equal(got[k], v, `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)} — full ${JSON.stringify(got)}`);
    }
  });
}

test("key / מפתח rows record a reduction and are never counted", () => {
  // Real rows from Volta. The figure is a note about how big the reduction was;
  // counting it either way would misstate a total that was already netted off.
  for (const s of ["מפתח שנעשה - 18.25h", "מפתח שנעשה - 15.75h"]) {
    const p = parseLegacyName(s);
    assert.equal(p.actual, null, s);
    assert.equal(p.isKeyRow, true, s);
    assert.ok(p.flags.includes("key-reduction-not-counted"), s);
  }
  // Dividers and pool tasks carry no figure anyway, but must still be marked.
  for (const s of ["--- Keys ---", "keys", "Blazepod Keys", "Arison Keys"]) {
    assert.equal(parseLegacyName(s).actual, null, s);
    assert.equal(parseLegacyName(s).isKeyRow, true, s);
  }
  // "monkey", "keyboard" etc. must NOT trip the rule.
  assert.equal(parseLegacyName("Keyboard shortcuts - 3h").actual, 3);
  assert.equal(parseLegacyName("Keyboard shortcuts - 3h").isKeyRow, false);
});

test("budget range reports both ends", () => {
  const p = parseLegacyName("Website Wireframes (32-42) - 16.75h");
  assert.equal(p.budget, 32, "low end");
  assert.equal(p.budgetMax, 42, "high end — this is what estimate_hours gets");
});

// Every string here is a real comment from the Volta "QA (24-32 - final 17.5)"
// thread, which is what exposed both bugs: reductions counted as positive, and a
// quoted cap counted as work.
test("comment hours — log lines", () => {
  assert.equal(parseCommentHours("3h"), 3);
  assert.equal(parseCommentHours("1.5h"), 1.5);
  assert.equal(parseCommentHours("<body>2h</body>"), 2);
  assert.equal(parseCommentHours("1.75 hrs"), 1.75);
  // date prefix, then the figure
  assert.equal(parseCommentHours("23/11 5.75h שיחה עם טדי ותיקונים"), 5.75);
  assert.equal(parseCommentHours("3/1 3h"), 3);
  assert.equal(parseCommentHours("2.75h תיקונים - 2.25 אפטר דמו - 0.5"), 2.75);
  assert.equal(parseCommentHours("1.25h מעבר על הQA של חגית"), 1.25);
});

test("comment hours — מפתח reductions are negative", () => {
  assert.equal(parseCommentHours("-11.5h מפתח https://app.asana.com/0/366074454182728/list"), -11.5);
  assert.equal(parseCommentHours("-2.5H מפתח https://app.asana.com/0/x"), -2.5);
  assert.equal(parseCommentHours("-2.25h מפתח על שעות אור"), -2.25);
});

test("comment hours — prose that only mentions a number is not a log", () => {
  // A CAP being quoted, not work done. This one figure alone was adding 17.5h.
  assert.equal(
    parseCommentHours("כל עבודה שמושקעת מעל 17.5 שעות מבוטלת בהתאם להערכה שנתנו לחגית"),
    null,
  );
  assert.equal(parseCommentHours("did the logo, 2.5 hours"), null, "figure must lead");
  assert.equal(parseCommentHours("1.75"), null, "a bare number is not hours");
  assert.equal(parseCommentHours("see item 5"), null);
  assert.equal(parseCommentHours("fixed 3 of them"), null);
  assert.equal(parseCommentHours("looks good!"), null);
  assert.equal(parseCommentHours("see 12/5 for the deadline"), null);
  assert.equal(parseCommentHours("48h"), null, "over 24h in one comment is a parse error");
  assert.equal(parseCommentHours(""), null);
});
