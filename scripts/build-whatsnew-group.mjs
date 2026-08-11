// Draws the "task groups" element for the "Version X is out" panel.
//
//   node scripts/build-whatsnew-group.mjs
//   → public/whats-new/1.13.0-group.svg
//
// ⚠️ DRAWN AT LIFE SIZE, like `build-whatsnew-phone.mjs`, and for the same
// reason: proportions cannot be guessed one element at a time. Every value below
// is the one the client table actually uses — `h-10` task rows, `pl-9` content,
// 16px section headings against 14px rows, the 18px indent per level.
//
// ⚠️ THE CROP IS CHOSEN SO THE SCALE STAYS HIGH. The panel renders an `element`
// at ~318px wide, so a 372px drawing lands at ~0.86 and a real 13px label reads
// at 11px. Drawing the whole Timeline instead — pinned column plus a useful
// slice of calendar is ~570px — would have scaled to 0.55 and put those labels
// at 7px, which is the exact failure the phone mockup was rebuilt to avoid. The
// hierarchy is the news, and the hierarchy lives in the name column.
//
// The icon is lucide's real geometry, read from `node_modules` at build time,
// so it cannot drift from the one the app renders.

import { readFileSync, writeFileSync } from "node:fs";

const OUT = "public/whats-new/1.13.0-group.svg";

/* ── Life-size geometry, all of it the client table's own ───────────────── */

const W = 372;
const HEAD_H = 26; // the column-header strip
const SECTION_H = 30; // `py-1.5` around a 16px heading
const GROUP_H = 30;
const ROW_H = 40; // `h-10`
const BASE_PL = 36; // `pl-9`
const INDENT = 18; // one level of nesting
const PAD_R = 12;

const ROWS = [
  { title: "Home page - wireframe", due: "16/8", budget: "6h" },
  { title: "Home page - design", due: "18/8", budget: "80h" },
  { title: "Home page - visuals", due: "30/8", budget: "16h" },
];
const H = HEAD_H + SECTION_H + GROUP_H + ROWS.length * ROW_H;

const C = {
  fg: "#06112f",
  muted: "#5c6478",
  faint: "#98a0b3",
  border: "#e5e7eb",
  surface: "#ffffff",
  brand: "#0b43ed",
};
const sans = "system-ui, -apple-system, sans-serif";

/* ── Icons ──────────────────────────────────────────────────────────────── */

function lucide(name) {
  const src = readFileSync(`node_modules/lucide-react/dist/esm/icons/${name}.mjs`, "utf8");
  const ds = [...src.matchAll(/d:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) throw new Error(`no path data in lucide icon "${name}" — did the package layout change?`);
  return ds;
}

/** ⚠️ Scaling an icon scales its STROKE, so the weight is divided back out. */
function icon(name, x, y, size, stroke, weight = 1.75) {
  const s = size / 24;
  const paths = lucide(name).map((d) => `<path d="${d}"/>`).join("");
  return (
    `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" fill="none" stroke="${stroke}"` +
    ` stroke-width="${(weight / s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
  );
}

/** The hollow completion circle every task row leads with. */
function tick(x, y) {
  return `<circle cx="${x + 8}" cy="${y}" r="8" fill="none" stroke="${C.border}" stroke-width="1.6"/>`;
}

function rule(y) {
  return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.border}" stroke-width="1"/>`;
}

/** A chevron, drawn open (pointing down) as both headings are here. */
function chevron(x, y) {
  return icon("chevron-down", x, y - 6.5, 13, C.muted, 2);
}

/* ── Draw ───────────────────────────────────────────────────────────────── */

let y = 0;
const parts = [];

// Column header — the chrome that makes this read as the real table rather than
// as a floating list (rule: draw the card, not the contents).
parts.push(
  `<text x="${BASE_PL}" y="${17}" font-family="${sans}" font-size="10" font-weight="500" letter-spacing="0.5" fill="${C.faint}">NAME</text>`,
  `<text x="${W - PAD_R - 96}" y="${17}" font-family="${sans}" font-size="10" font-weight="500" letter-spacing="0.5" fill="${C.faint}">DUE</text>`,
  `<text x="${W - PAD_R}" y="${17}" font-family="${sans}" font-size="10" font-weight="500" letter-spacing="0.5" fill="${C.faint}" text-anchor="end">BUDGET</text>`,
  rule(HEAD_H),
);
y = HEAD_H;

// Section heading — 16px, the top of the three-step hierarchy.
parts.push(
  chevron(BASE_PL - 20, y + SECTION_H / 2),
  `<text x="${BASE_PL}" y="${y + SECTION_H / 2 + 5.5}" font-family="${sans}" font-size="16" font-weight="600" fill="${C.fg}">Website - phase 1</text>`,
  `<text x="${BASE_PL + 124}" y="${y + SECTION_H / 2 + 5}" font-family="${sans}" font-size="12" fill="${C.faint}">12</text>`,
  `<text x="${W - PAD_R}" y="${y + SECTION_H / 2 + 4.5}" font-family="${sans}" font-size="11" fill="${C.faint}" text-anchor="end">18/8 – 14/10 · 44d · 3/361h</text>`,
  rule(y + SECTION_H),
);
y += SECTION_H;

// THE GROUP — one level in, 14px against the section's 16, with the Layers icon
// and its own rolled-up figures. This row is the entire point of the picture.
const gx = BASE_PL + INDENT;
parts.push(
  chevron(gx - 20, y + GROUP_H / 2),
  icon("layers", gx, y + GROUP_H / 2 - 7, 14, C.muted),
  `<text x="${gx + 19}" y="${y + GROUP_H / 2 + 5}" font-family="${sans}" font-size="14" font-weight="600" fill="${C.fg}">Home page</text>`,
  `<text x="${gx + 94}" y="${y + GROUP_H / 2 + 4.5}" font-family="${sans}" font-size="12" fill="${C.faint}">3</text>`,
  `<text x="${W - PAD_R}" y="${y + GROUP_H / 2 + 4}" font-family="${sans}" font-size="11" fill="${C.faint}" text-anchor="end">18/8 – 3/9 · 12d · 18/102h</text>`,
  rule(y + GROUP_H),
);
y += GROUP_H;

// Its tasks, one level in again — the indent is what says "inside".
const tx = BASE_PL + INDENT * 2;
for (const r of ROWS) {
  const mid = y + ROW_H / 2;
  parts.push(
    tick(tx, mid),
    `<text x="${tx + 24}" y="${mid + 4.5}" font-family="${sans}" font-size="13" fill="${C.fg}">${r.title}</text>`,
    `<text x="${W - PAD_R - 96}" y="${mid + 4.5}" font-family="${sans}" font-size="12" fill="${C.muted}">${r.due}</text>`,
    `<text x="${W - PAD_R}" y="${mid + 4.5}" font-family="${sans}" font-size="12" fill="${C.muted}" text-anchor="end">${r.budget}</text>`,
    rule(y + ROW_H),
  );
  y += ROW_H;
}

/* ── Checks that have each cost a round of review ───────────────────────── */

if (y !== H) throw new Error(`drew ${y}px of rows into a ${H}px canvas`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The client task list: a Website section holding a Home page group, with that group's three tasks indented under it and its dates and hours totalled beside it">
  <!-- GENERATED by scripts/build-whatsnew-group.mjs - edit that, not this.
       Drawn at the client table's own life-size values and scaled as one piece. -->
  <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="${C.surface}"/>
  ${parts.join("\n  ")}
</svg>
`;

// ⚠️ A CSS custom property in an SVG comment kills the whole file: the two
// hyphens in `var(--brand)` are illegal inside an XML comment, and the symptom
// is a 200 response with balanced tags and a blank picture. Check the comments,
// not just the tags.
for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
  if (c.slice(4, -3).includes("--")) throw new Error("double hyphen inside an XML comment");
}
if (/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg)) throw new Error("bare ampersand");

writeFileSync(OUT, svg);
console.log(
  `${OUT} - ${W}x${H} at life size; the panel shows it ~318px wide, so ~${(318 / W).toFixed(2)}x ` +
    `(a 13px label lands at ${((318 / W) * 13).toFixed(1)}px)`,
);
