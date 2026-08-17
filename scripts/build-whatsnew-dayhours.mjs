// Draws the phone mockup for "your day adds up as you log it".
//
//   node scripts/build-whatsnew-dayhours.mjs
//   → public/whats-new/1.19.0-day-hours.svg
//
// ⚠️ DRAWN AT REAL PHONE DIMENSIONS — a 375×812 screen with the app's own values
// (`h-14` header, the sheet's `rounded-t-2xl` and 4px grabber, `px-4` body,
// 44px controls) — and scaled by the panel as one piece. See
// `build-whatsnew-phone.mjs` for why guessing sizes on a small canvas fails.
//
// ⚠️ THE SHEET IS DRAWN HIGH UP THE SCREEN, and that is a constraint of the
// PANEL, not a lie about the app. A `phone` image is rendered `h-[620px]` inside
// a 440px box with `mt-8`, anchored top — so only the top ~553px of an 840px
// drawing is ever visible, and a sheet sitting at the true bottom of an 812px
// screen would be cropped away entirely. A real sheet holding this much (form,
// total, two entries) genuinely reaches this far up; the assertion at the bottom
// keeps every part of it inside the visible band.

import { readFileSync, writeFileSync } from "node:fs";

const OUT = "public/whats-new/1.19.0-day-hours.svg";

/* ── Life-size geometry ─────────────────────────────────────────────────── */

const SCREEN = { w: 375, h: 812 };
const BEZEL = 14;
const RADIUS = 44;
const DEV = { w: SCREEN.w + BEZEL * 2, h: SCREEN.h + BEZEL * 2 };
const SX = BEZEL, SY = BEZEL;
const PAD = 16; // `p-4`
const HEADER_H = 56; // `h-14`
const X = SX + PAD;
const CW = SCREEN.w - PAD * 2; // 343

/** How much of the drawing the panel actually shows — see the header note. */
const VISIBLE_H = 553;

const SHEET_TOP = SY + 150; // screen y 150; the assertion below is the real gate
const SB = SX + PAD; // sheet body left edge, `px-4`
const SBW = SCREEN.w - PAD * 2;

const C = {
  fg: "#06112f",
  muted: "#5c6478",
  faint: "#98a0b3",
  border: "#e5e7eb",
  strong: "#d1d5db",
  surface: "#ffffff",
  page: "#f0f1fa",
  brand: "#0b43ed",
  success: "#16a34a",
};
const sans = "system-ui, -apple-system, sans-serif";
const serif = "Georgia, serif";

/** The day being drawn: 3h 30m of 8h, which is a bar you can read at a glance. */
const TARGET = 8 * 60;
const ENTRIES = [
  { client: "Anchor", mark: "#ef0bd0", task: "Branding", note: "Wireframing", mins: 180, label: "3h" },
  { client: "Studio", mark: "#1d32c8", task: "Onboarding", note: "Weekly sync", mins: 30, label: "30m" },
];
const LOGGED = ENTRIES.reduce((s, e) => s + e.mins, 0);

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

/** A `sm` ClientChip: 22px capsule, mark flush left. Estimate as in the sibling script. */
const chipW = (name) => Math.round(2 + 16 + 4 + name.length * 6.35 + 8);
function chip(x, y, name, mark) {
  const w = chipW(name);
  const cy = y + 11;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${C.surface}" stroke="${C.border}"/>` +
    `<circle cx="${x + 10}" cy="${cy}" r="8" fill="${mark}"/>` +
    `<text x="${x + 10}" y="${cy + 3.2}" font-family="${sans}" font-size="9" font-weight="600" fill="#ffffff" text-anchor="middle">${name[0]}</text>` +
    `<text x="${x + 22}" y="${cy + 4}" font-family="${sans}" font-size="12" font-weight="500" fill="${C.fg}">${name}</text>`
  );
}

/* ── Draw ───────────────────────────────────────────────────────────────── */

const parts = [];
let y = SHEET_TOP;

// grabber — `pt-2.5 pb-1` around a 4px rule, and decoration, not a control
parts.push(
  `<rect x="${SX + SCREEN.w / 2 - 18}" y="${y + 10}" width="36" height="4" rx="2" fill="${C.strong}"/>`,
);
y += 25;

// the back row: the task this is logging against
parts.push(
  icon("chevron-left", SB - 4, y + 4, 17, C.muted, 2),
  `<text x="${SB + 18}" y="${y + 16}" font-family="${sans}" font-size="14" fill="${C.muted}">Branding</text>`,
);
y += 40;

// duration + the phone-only quick chips
parts.push(
  `<rect x="${SB}" y="${y}" width="84" height="44" rx="6" fill="${C.surface}" stroke="${C.border}"/>`,
  `<text x="${SB + 12}" y="${y + 28}" font-family="${sans}" font-size="16" fill="${C.fg}">1.5h</text>`,
);
["30m", "1h", "2h"].forEach((q, i) => {
  const qx = SB + 96 + i * 66;
  parts.push(
    `<rect x="${qx}" y="${y}" width="58" height="44" rx="6" fill="${C.surface}" stroke="${C.border}"/>`,
    `<text x="${qx + 29}" y="${y + 28}" font-family="${sans}" font-size="16" fill="${C.muted}" text-anchor="middle">${q}</text>`,
  );
});
y += 54;

// description — mandatory, which is why it is the widest control here
parts.push(
  `<rect x="${SB}" y="${y}" width="${SBW}" height="44" rx="6" fill="${C.surface}" stroke="${C.border}"/>`,
  `<text x="${SB + 12}" y="${y + 28}" font-family="${sans}" font-size="16" fill="${C.faint}">What did you do? (required)</text>`,
);
y += 54;

parts.push(
  `<rect x="${SB + SBW - 108}" y="${y}" width="108" height="44" rx="6" fill="${C.fg}"/>`,
  `<text x="${SB + SBW - 54}" y="${y + 28}" font-family="${sans}" font-size="15" font-weight="600" fill="#ffffff" text-anchor="middle">Add time</text>`,
);
y += 60;

// THE NEWS: the day so far, against this person's own target.
parts.push(`<line x1="${SB}" y1="${y}" x2="${SB + SBW}" y2="${y}" stroke="${C.border}"/>`);
y += 18;
parts.push(
  `<text x="${SB}" y="${y + 6}" font-family="${sans}" font-size="14" fill="${C.muted}">Logged today</text>`,
  `<text x="${SB + SBW}" y="${y + 6}" font-family="${sans}" font-size="14" font-weight="600" fill="${C.fg}" text-anchor="end">3h 30m<tspan fill="${C.muted}" font-weight="400"> / 8h</tspan></text>`,
);
y += 16;
const fill = Math.round(SBW * (LOGGED / TARGET));
parts.push(
  `<rect x="${SB}" y="${y}" width="${SBW}" height="6" rx="3" fill="${C.border}"/>`,
  `<rect x="${SB}" y="${y}" width="${fill}" height="6" rx="3" fill="${LOGGED >= TARGET ? C.success : C.brand}"/>`,
);
y += 20;

// every entry of the day, each one a tap away from being fixed
for (const e of ENTRIES) {
  parts.push(
    chip(SB, y + 4, e.client, e.mark),
    `<text x="${SB + chipW(e.client) + 8}" y="${y + 19}" font-family="${sans}" font-size="14" fill="${C.fg}">${e.task}</text>`,
    `<text x="${SB}" y="${y + 40}" font-family="${sans}" font-size="12" fill="${C.muted}">${e.note}</text>`,
    `<text x="${SB + SBW}" y="${y + 19}" font-family="${sans}" font-size="14" fill="${C.muted}" text-anchor="end">${e.label}</text>`,
  );
  y += 52;
}

/* ── The check this drawing exists to satisfy ───────────────────────────── */

if (y > SY + VISIBLE_H - 8) {
  throw new Error(
    `the sheet's content ends at ${y}px, past the ${SY + VISIBLE_H}px the panel ever shows — ` +
      "raise SHEET_TOP or drop a row, don't let the news fall off the bottom",
  );
}

const heroY = SY + HEADER_H + PAD;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DEV.w} ${DEV.h}" width="${DEV.w}" height="${DEV.h}" role="img" aria-label="Logging time on a phone: under the form, Logged today reads 3h 30m of 8h over a part-filled bar, with the day's two entries listed beneath it">
  <!-- GENERATED by scripts/build-whatsnew-dayhours.mjs - edit that, not this.
       Drawn at a real 375x812 screen and scaled down as one piece. -->
  <defs>
    <clipPath id="scr"><rect x="${SX}" y="${SY}" width="${SCREEN.w}" height="${SCREEN.h}" rx="${RADIUS}"/></clipPath>
  </defs>

  <rect x="0" y="0" width="${DEV.w}" height="${DEV.h}" rx="${RADIUS + BEZEL}" fill="#06112f"/>
  <rect x="${SX}" y="${SY}" width="${SCREEN.w}" height="${SCREEN.h}" rx="${RADIUS}" fill="${C.page}"/>

  <g clip-path="url(#scr)">
    <!-- the page behind, and the sheet's own backdrop over it: bg-black/40 -->
    <rect x="${SX}" y="${SY}" width="${SCREEN.w}" height="${HEADER_H}" fill="${C.surface}"/>
    <text x="${X}" y="${SY + 37}" font-family="${sans}" font-size="22" font-weight="700" fill="${C.brand}">&amp;more</text>
    <rect x="${X}" y="${heroY}" width="${CW}" height="120" rx="16" fill="${C.brand}"/>
    <text x="${X + 20}" y="${heroY + 44}" font-family="${serif}" font-style="italic" font-size="26" fill="#ffffff">Hi Nadav</text>
    <text x="${X + 20}" y="${heroY + 72}" font-family="${sans}" font-size="13" fill="#dde6fd">7.5h this week</text>
    <rect x="${SX}" y="${SY}" width="${SCREEN.w}" height="${SCREEN.h}" fill="#000000" opacity="0.4"/>

    <!-- the sheet: rounded-t-2xl, border-t, running to the bottom edge -->
    <path d="M${SX} ${SHEET_TOP + 16} a16 16 0 0 1 16 -16 h${SCREEN.w - 32} a16 16 0 0 1 16 16 v${SCREEN.h - (SHEET_TOP - SY)} h-${SCREEN.w} z" fill="${C.surface}" stroke="${C.border}"/>
    ${parts.join("\n    ")}
  </g>

  <!-- dynamic island -->
  <rect x="${SX + SCREEN.w / 2 - 60}" y="${SY + 12}" width="120" height="34" rx="17" fill="#06112f"/>
</svg>
`;

for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
  if (c.slice(4, -3).includes("--")) throw new Error("double hyphen inside an XML comment");
}
if (/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg)) throw new Error("bare ampersand");

writeFileSync(OUT, svg);
console.log(
  `${OUT} - ${DEV.w}x${DEV.h} at life size; the panel shows the top ${VISIBLE_H}px at ` +
    `${(620 / DEV.h).toFixed(2)}x (a 14px label lands at ${((620 / DEV.h) * 14).toFixed(1)}px). ` +
    `Sheet content ends at ${y}px, ${SY + VISIBLE_H - y}px of headroom.`,
);
