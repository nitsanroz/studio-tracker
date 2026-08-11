// Draws the "Section totals" switch for the "Version X is out" panel.
//
//   node scripts/build-whatsnew-totals.mjs
//   → public/whats-new/1.13.0-totals.svg
//
// ⚠️ DRAWN AT LIFE SIZE from `show-menu.tsx`'s own values — `w-56` panel, `p-1`,
// `rounded-xl`, 32px rows (`text-sm` on `py-1.5`), a 16×28 switch with a 12px
// knob, `gap-2.5` between a 16px emoji column and the label. Same rule as every
// other visual here: draw it real, scale it once.
//
// ⚠️ THE WHOLE MENU, not a crop of it. A card sliced at its edge reads as a
// rendering fault (unlike a device, which may bleed), so the type list is drawn
// in full rather than cut off under the switches — which is also why this image
// is taller than the other one. It renders ~376px tall inside the panel's 440px,
// so nothing is clipped.
//
// The icons are lucide's real geometry, read from `node_modules` at build time.

import { readFileSync, writeFileSync } from "node:fs";

const OUT = "public/whats-new/1.13.0-totals.svg";

/* ── Life-size geometry, all of it show-menu.tsx's own ──────────────────── */

const MENU_W = 224; // `w-56`
const PAD = 4; // `p-1`
const ROW_H = 32; // `text-sm` (20px line) + `py-1.5`
const ROW_PX = 8; // `px-2`
const GAP = 10; // `gap-2.5`
const TRIGGER_H = 32; // `h-8`
const MENU_TOP_GAP = 6; // `mt-1.5`
const SW_W = 28; // `w-7`
const SW_H = 16; // `h-4`
const KNOB = 12; // `size-3`
const TYPE_HEAD_H = 24; // `pt-2` + a 10px line + `pb-1`

const W = 372; // matches the sibling visual, so the two scale alike

const SWITCHES = [
  { emoji: "✅", label: "Completed", on: false },
  { emoji: "🗓️", label: "Undated", on: false },
  { emoji: "🎨", label: "Colour by type", on: true },
  { emoji: "🧮", label: "Section totals", on: true, isNew: true },
];
// The studio's real types, in the order Settings lists them.
const TYPES = [
  ["Design", "#0b43ed"],
  ["Wireframe", "#7c3aed"],
  ["Image making", "#ef0bd0"],
  ["Development", "#0f766e"],
  ["QA", "#0f9d58"],
  ["Mobile", "#d7a10f"],
  ["prep 4 dev", "#0891b2"],
];

const MENU_H = PAD * 2 + SWITCHES.length * ROW_H + TYPE_HEAD_H + TYPES.length * ROW_H;
const H = TRIGGER_H + MENU_TOP_GAP + MENU_H;

const C = {
  fg: "#06112f",
  muted: "#5c6478",
  faint: "#98a0b3",
  border: "#e5e7eb",
  borderStrong: "#cbd0da",
  surface: "#ffffff",
  brand: "#0b43ed",
  off: "#cbd0da", // `bg-border-strong`, the switch's resting track
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

/** The sr-only checkbox's visible track and knob. */
function toggle(x, cy, on) {
  const knobX = on ? x + SW_W - KNOB - 2 : x + 2;
  return (
    `<rect x="${x}" y="${cy - SW_H / 2}" width="${SW_W}" height="${SW_H}" rx="${SW_H / 2}" fill="${on ? C.brand : C.off}"/>` +
    `<circle cx="${knobX + KNOB / 2}" cy="${cy}" r="${KNOB / 2}" fill="#ffffff"/>`
  );
}

/* ── Draw ───────────────────────────────────────────────────────────────── */

const MX = W - MENU_W; // the menu is `right-0` under the trigger
const parts = [];

// The trigger, in its resting state — ⚠️ NOT lit. "Section totals" being on must
// never colour it: the trigger reports what you are NOT seeing, and a total is
// not a hidden task. Drawing it brand-coloured here would teach the opposite.
const trigW = 78;
const trigX = W - trigW;
parts.push(
  `<rect x="${trigX}" y="0" width="${trigW}" height="${TRIGGER_H}" rx="${TRIGGER_H / 2}" fill="${C.surface}" stroke="${C.border}"/>`,
  icon("eye", trigX + 12, TRIGGER_H / 2 - 7, 14, C.muted),
  `<text x="${trigX + 32}" y="${TRIGGER_H / 2 + 5}" font-family="${sans}" font-size="14" font-weight="500" fill="${C.muted}">Show</text>`,
  icon("chevron-down", trigX + trigW - 12 - 13, TRIGGER_H / 2 - 6.5, 13, C.faint),
);

// The panel.
const MY = TRIGGER_H + MENU_TOP_GAP;
parts.push(
  `<rect x="${MX}" y="${MY}" width="${MENU_W}" height="${MENU_H}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`,
);

let y = MY + PAD;
for (const s of SWITCHES) {
  const cy = y + ROW_H / 2;
  // The new row carries the same `hover:bg-background` tint the menu gives the
  // row under the pointer — the honest way to draw attention without inventing
  // a highlight the app does not have.
  if (s.isNew) {
    parts.push(
      `<rect x="${MX + PAD}" y="${y}" width="${MENU_W - PAD * 2}" height="${ROW_H}" rx="6" fill="#f0f1fa"/>`,
    );
  }
  parts.push(
    `<text x="${MX + PAD + ROW_PX + 8}" y="${cy + 4.5}" font-family="${sans}" font-size="13" text-anchor="middle">${s.emoji}</text>`,
    `<text x="${MX + PAD + ROW_PX + 16 + GAP}" y="${cy + 5}" font-family="${sans}" font-size="14" fill="${C.fg}">${s.label}</text>`,
    toggle(MX + MENU_W - PAD - ROW_PX - SW_W, cy, s.on),
  );
  y += ROW_H;
}

// The TYPE block, drawn in full — see the note at the top about not cropping.
parts.push(
  `<text x="${MX + PAD + ROW_PX}" y="${y + 16}" font-family="${sans}" font-size="10" font-weight="500" letter-spacing="0.5" fill="${C.faint}">TYPE</text>`,
);
y += TYPE_HEAD_H;

for (const [name, colour] of TYPES) {
  const cy = y + ROW_H / 2;
  const bx = MX + PAD + ROW_PX;
  parts.push(
    `<rect x="${bx}" y="${cy - 8}" width="16" height="16" rx="4" fill="${C.brand}" stroke="${C.brand}"/>`,
    icon("check", bx + 2.5, cy - 5.5, 11, "#ffffff", 3),
    `<rect x="${bx + 16 + GAP}" y="${cy - 5}" width="10" height="10" rx="2" fill="${colour}"/>`,
    `<text x="${bx + 16 + GAP + 10 + GAP}" y="${cy + 5}" font-family="${sans}" font-size="14" fill="${C.fg}">${name}</text>`,
  );
  y += ROW_H;
}

/* ── Checks that have each cost a round of review ───────────────────────── */

if (y !== MY + MENU_H - PAD) throw new Error(`rows ended at ${y}, panel expects ${MY + MENU_H - PAD}`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Show menu open, with a new Section totals switch turned on beneath Completed, Undated and Colour by type">
  <!-- GENERATED by scripts/build-whatsnew-totals.mjs - edit that, not this.
       Drawn at show-menu.tsx's own life-size values and scaled as one piece. -->
  ${parts.join("\n  ")}
</svg>
`;

// ⚠️ A CSS custom property in an SVG comment kills the whole file: the two
// hyphens in `var(--brand)` are illegal inside an XML comment, and the symptom is
// a 200 response with balanced tags and a blank picture.
for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
  if (c.slice(4, -3).includes("--")) throw new Error("double hyphen inside an XML comment");
}
if (/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg)) throw new Error("bare ampersand");

writeFileSync(OUT, svg);
const scale = 318 / W;
console.log(
  `${OUT} - ${W}x${H} at life size; shown ~318px wide (${scale.toFixed(2)}x), ` +
    `so a 14px label reads at ${(scale * 14).toFixed(1)}px and it stands ${Math.round(scale * H)}px tall in a 440px panel`,
);
