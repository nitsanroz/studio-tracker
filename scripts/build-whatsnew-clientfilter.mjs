// Draws the "filter a task search by client" element for the what's-new panel.
//
//   node scripts/build-whatsnew-clientfilter.mjs
//   → public/whats-new/1.19.0-client-filter.svg
//
// ⚠️ DRAWN AT LIFE SIZE, like the other two element scripts: every value below is
// the one the picker actually renders — a 38px field, `rounded-md` 6px, the panel
// at the 303px it measured in the browser with results in it, 22px `sm` client
// chips with 6px gaps, 14px task titles.
//
// ⚠️ IT SHOWS THE GESTURE, NOT THE OUTCOME — a cursor on the "No Traffic" chip,
// with the list still un-narrowed beneath it. The two states cannot share a frame
// (the chips are gone the moment a client is chosen, which is the whole design),
// and of the two this is the one that teaches the control. The RESULTS carry the
// argument instead: three tasks called some form of "Homepage", one per client,
// which is exactly why the filter exists.
//
// ⚠️ The client MARKS are the one approximation here — the names, the geometry
// and the truncation are the app's, but each mark's colour is eyeballed from the
// verified screenshots rather than read from `clients.color`. Anchor's is the
// exception: `#ef0bd0` is recorded in the working log (v1.5.2).

import { readFileSync, writeFileSync } from "node:fs";

const OUT = "public/whats-new/1.19.0-client-filter.svg";

/* ── Life-size geometry, all of it the picker's own ──────────────────────── */

const W = 360;
const FIELD_W = 256; // the log-time popup's own picker cell
const FIELD_H = 38;
const GAP = 6; // `mt-1.5` between the field and its panel
const PANEL_W = 303; // measured with results in it
const PANEL_PAD = 4; // `p-1`
const CHIP_H = 22; // a `sm` ClientChip
const CHIP_GAP = 6; // `gap-1.5`
const ROW_H = 30; // `px-2 py-1.5` around a 14px title

const C = {
  fg: "#06112f",
  muted: "#5c6478",
  faint: "#98a0b3",
  border: "#e5e7eb",
  surface: "#ffffff",
  brand: "#0b43ed",
};
const sans = "system-ui, -apple-system, sans-serif";

/** Recency order, as the row really comes out for this studio. */
const CHIPS = [
  { name: "No Traffic", mark: "#2f6df6" },
  { name: "Studio", mark: "#1d32c8" },
  { name: "DualBird", mark: "#e0642b" },
  { name: "Visitt", mark: "#16a34a" },
];

/** Three real tasks, three clients, one word — the reason the filter exists. */
const ROWS = [
  { title: "Homepage", client: { name: "DualBird", mark: "#e0642b" } },
  { title: "Home page - design", client: { name: "Anchor", mark: "#ef0bd0" } },
  { title: "Homepage stockholders sec…", client: { name: "No Traffic", mark: "#2f6df6" } },
];

/* ── Text metrics ───────────────────────────────────────────────────────────
   No font metrics are available in a build script, so chip widths come from a
   per-character estimate. ⚠️ It only has to be close: a chip 3px wide of the
   truth is invisible at 0.86, but a chip sized by a GUESS at the whole capsule
   would drift out of the row. Measured against the rendered chips: 12px system
   sans averages ~6.35px per character for these names. */
const CH = 6.35;
const chipW = (name) => Math.round(2 + 16 + 4 + name.length * CH + 8);

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

/**
 * One client chip: the mark flush to the capsule's left edge (`pl-0.5`), which is
 * what keeps it at 22px — see v1.5.1, where symmetric padding would have made
 * every chip in the app taller.
 */
function chip(x, y, { name, mark }, ringed = false) {
  const w = chipW(name);
  const cy = y + CHIP_H / 2;
  return (
    (ringed
      ? `<rect x="${x - 2.5}" y="${y - 2.5}" width="${w + 5}" height="${CHIP_H + 5}" rx="${(CHIP_H + 5) / 2}" fill="none" stroke="${C.brand}" stroke-width="2"/>`
      : "") +
    `<rect x="${x}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${C.surface}" stroke="${C.border}"/>` +
    `<circle cx="${x + 2 + 8}" cy="${cy}" r="8" fill="${mark}"/>` +
    `<text x="${x + 2 + 8}" y="${cy + 3.2}" font-family="${sans}" font-size="9" font-weight="600" fill="#ffffff" text-anchor="middle">${name[0]}</text>` +
    `<text x="${x + 2 + 16 + 4}" y="${cy + 4}" font-family="${sans}" font-size="12" font-weight="500" fill="${C.fg}">${name}</text>`
  );
}

/** The pointer, drawn rather than implied — the marquee element set this rule. */
function cursor(x, y) {
  const d = "M0 0 L0 15.5 L4.1 11.6 L6.7 17.5 L9.5 16.2 L6.9 10.5 L12.4 10.3 Z";
  return (
    `<g transform="translate(${x} ${y})">` +
    `<path d="${d}" fill="${C.fg}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>` +
    `</g>`
  );
}

/* ── Draw ───────────────────────────────────────────────────────────────── */

const parts = [];

// The field. Empty on purpose: nothing has been typed, and the chips are the
// answer to "I don't know what this task is called".
parts.push(
  `<rect x="0" y="0" width="${FIELD_W}" height="${FIELD_H}" rx="6" fill="${C.surface}" stroke="${C.border}"/>`,
  `<text x="10" y="${FIELD_H / 2 + 5}" font-family="${sans}" font-size="14" fill="${C.faint}">Which task?</text>`,
);

const panelY = FIELD_H + GAP;
const chipsY = panelY + PANEL_PAD + 4;
const dividerY = chipsY + CHIP_H + 6;
const rowsY = dividerY + 5;
const PANEL_H = rowsY - panelY + ROWS.length * ROW_H + PANEL_PAD;
const H = panelY + PANEL_H;

parts.push(
  `<rect x="0" y="${panelY}" width="${PANEL_W}" height="${PANEL_H}" rx="12" fill="${C.surface}" stroke="${C.border}"/>`,
);

// The chip row. It scrolls sideways in the app, so the last chip is CUT by the
// panel's edge — that clipped edge is the only honest way to say "there are more".
let cx = PANEL_PAD + 4;
for (const c of CHIPS) {
  parts.push(chip(cx, chipsY, c, c.name === "No Traffic"));
  cx += chipW(c.name) + CHIP_GAP;
}
parts.push(
  `<line x1="${PANEL_PAD}" y1="${dividerY}" x2="${PANEL_W - PANEL_PAD}" y2="${dividerY}" stroke="${C.border}"/>`,
);

// The results, still un-narrowed: three clients, one word between them.
ROWS.forEach((r, i) => {
  const y = rowsY + i * ROW_H;
  const mid = y + ROW_H / 2;
  const cw = chipW(r.client.name);
  parts.push(
    `<text x="${PANEL_PAD + 6}" y="${mid + 4.5}" font-family="${sans}" font-size="14" fill="${C.fg}">${r.title}</text>`,
    chip(PANEL_W - PANEL_PAD - 6 - cw, mid - CHIP_H / 2, r.client),
  );
});

// On the chip it is about to filter by, and the ring says which one that is.
parts.push(cursor(PANEL_PAD + 4 + chipW("No Traffic") - 26, chipsY + CHIP_H - 6));

/* ── Checks that have each cost a round of review ───────────────────────── */

const widest = PANEL_PAD + 4 + CHIPS.reduce((s, c) => s + chipW(c.name) + CHIP_GAP, 0);
if (widest <= PANEL_W) {
  throw new Error(
    `the chip row (${widest}px) fits inside the panel (${PANEL_W}px) — then it cannot read as a` +
      " scroller, and 'there are more clients' is the point. Add a chip.",
  );
}
for (const r of ROWS) {
  const need = PANEL_PAD + 6 + r.title.length * 7.4 + 8 + chipW(r.client.name) + PANEL_PAD + 6;
  if (need > PANEL_W + 12) throw new Error(`row "${r.title}" overruns the panel — truncate it as the app would`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A task search open, with a scrolling row of client chips above the results and the pointer on No Traffic; the three results below are all called some form of Homepage and belong to three different clients">
  <!-- GENERATED by scripts/build-whatsnew-clientfilter.mjs - edit that, not this.
       Drawn at the picker's own life-size values and scaled as one piece. -->
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
console.log(
  `${OUT} - ${W}x${H} at life size; the panel shows it ~318px wide, so ~${(318 / W).toFixed(2)}x ` +
    `(a 14px title lands at ${((318 / W) * 14).toFixed(1)}px, a 12px chip label at ${((318 / W) * 12).toFixed(1)}px)`,
);
