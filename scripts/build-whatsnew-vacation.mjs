// Draws the two "request vacation" elements for the what's-new panel (v1.76.0).
//
//   node scripts/build-whatsnew-vacation.mjs
//   → public/whats-new/1.76.0-vacation-card.svg
//   → public/whats-new/1.76.0-vacation-plan.svg
//
// ⚠️ DRAWN AT LIFE SIZE from the components' own values — the Home card is
// `rounded-2xl p-4` (16/16) with a 14px heading, a 30px figure (`text-3xl`),
// 12px notes, a `md` brand Button (px-3 py-1.5, 14px) and 14px request rows
// with the 11px status pill; the plan crop is the date column's 96px (`w-24`,
// `p-2`, 12px) against a person cell (~203×48 measured, `p-1.5`) tinted
// `.plan-cell-me` (aqua 10% on white).
//
// ⚠️ THE NUMBERS ARE ILLUSTRATIVE, ON PURPOSE. A real capture would put one
// colleague's vacation balance in front of the whole studio. The balance and
// dates here are plausible, not anybody's; the task chip is a real client's.
//
// ⚠️ The plan crop SHOWS THE GESTURE (the pointer on "Request vacation", in its
// hover colours) beside the RESULT of an earlier one (a day already asked for),
// since the button only exists under the pointer.

import { readFileSync, writeFileSync } from "node:fs";

const C = {
  fg: "#06112f",
  muted: "#5c6478",
  faint: "#98a0b3",
  border: "#e5e7eb",
  borderStrong: "#d1d5db",
  surface: "#ffffff",
  brand: "#0b43ed",
  amberBg: "#fef3c7",
  amberFg: "#92400e",
  emerald: "#34d399",
  emeraldFg: "#065f46",
  me: "#f1fefd",
};
const sans = "system-ui, -apple-system, sans-serif";

function lucide(name) {
  const src = readFileSync(`node_modules/lucide-react/dist/esm/icons/${name}.mjs`, "utf8");
  const ds = [...src.matchAll(/d:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) throw new Error(`no path data in lucide icon "${name}"`);
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
function cursor(x, y) {
  const d = "M0 0 L0 15.5 L4.1 11.6 L6.7 17.5 L9.5 16.2 L6.9 10.5 L12.4 10.3 Z";
  return `<g transform="translate(${x} ${y})"><path d="${d}" fill="${C.fg}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></g>`;
}
const text = (x, y, s, { size = 12, fill = C.fg, weight = 400, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${sans}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;
const shadow = (id) =>
  `<filter id="${id}" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#06112f" flood-opacity="0.10"/></filter>`;

/* ── 1. The Home card ───────────────────────────────────────────────────── */
{
  const x = 8;
  const y = 29;
  const w = 344;
  const h = 182;
  const p = 16;
  const parts = [];
  parts.push(`<defs>${shadow("vc")}</defs>`);
  parts.push(`<g filter="url(#vc)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.surface}" stroke="${C.border}"/></g>`);
  // heading row
  parts.push(icon("tree-palm", x + p, y + p + 1, 16, C.brand));
  parts.push(text(x + p + 22, y + p + 13, "Vacation", { size: 14, weight: 600 }));
  parts.push(text(x + w - p, y + p + 12, "All requests →", { size: 12, fill: C.brand, anchor: "end" }));
  // the figure and its note
  parts.push(text(x + p, y + 78, "7", { size: 30, weight: 400 }));
  parts.push(text(x + p, y + 98, "days left now · +1 each month", { size: 12, fill: C.muted }));
  parts.push(text(x + p, y + 113, "6 on your Sep payslip, 1 waiting", { size: 12, fill: C.muted }));
  // the button (md brand: px-3 py-1.5, 14px)
  const bw = 132;
  const bh = 32;
  const bx = x + w - p - bw;
  const by = y + 62;
  parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="${C.brand}"/>`);
  parts.push(text(bx + bw / 2, by + 21, "Request vacation", { size: 14, weight: 600, fill: "#ffffff", anchor: "middle" }));
  // a waiting request
  const ry = y + 132;
  parts.push(`<rect x="${x + p}" y="${ry}" width="${w - 2 * p}" height="1" fill="${C.border}"/>`);
  const rowY = ry + 30;
  parts.push(text(x + p, rowY, "18/11/26", { size: 14, weight: 600 }));
  parts.push(text(x + p + 68, rowY, "1 day", { size: 14, fill: C.muted }));
  const px = x + p + 112;
  parts.push(`<rect x="${px}" y="${rowY - 13}" width="124" height="18" rx="9" fill="${C.amberBg}"/>`);
  parts.push(text(px + 62, rowY, "Waiting for approval", { size: 11, weight: 600, fill: C.amberFg, anchor: "middle" }));
  parts.push(text(x + w - p, rowY, "Withdraw", { size: 12, fill: C.muted, anchor: "end" }));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" width="360" height="240" role="img" aria-label="The Vacation card on the home page: 7 days left now, a Request vacation button, and a one-day request waiting for approval">\n` +
    parts.join("\n") +
    `\n</svg>\n`;
  writeFileSync("public/whats-new/1.76.0-vacation-card.svg", svg);
}

/* ── 2. Your column in the weekly plan ──────────────────────────────────── */
{
  const x = 22;
  const y = 30;
  const dateW = 96;
  const cellW = 216;
  const rowH = 46;
  const rows = [
    { day: "Sunday", date: "15/11", kind: "task" },
    { day: "Monday", date: "16/11", kind: "requested" },
    { day: "Tuesday", date: "17/11", kind: "hover" },
    { day: "Wednesday", date: "18/11", kind: "empty" },
  ];
  const w = dateW + cellW;
  const h = rowH * rows.length;
  const parts = [];
  parts.push(`<defs>${shadow("vp")}<clipPath id="vpClip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/></clipPath></defs>`);
  parts.push(`<g filter="url(#vp)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.surface}" stroke="${C.border}"/></g>`);
  parts.push(`<g clip-path="url(#vpClip)">`);
  rows.forEach((r, i) => {
    const ry = y + i * rowH;
    parts.push(`<rect x="${x + dateW}" y="${ry}" width="${cellW}" height="${rowH}" fill="${C.me}"/>`);
    if (i) parts.push(`<rect x="${x}" y="${ry}" width="${w}" height="1" fill="${C.border}"/>`);
    parts.push(text(x + 8, ry + 18, r.day, { size: 12, weight: 600 }));
    parts.push(text(x + 8, ry + 33, r.date, { size: 12, fill: C.faint }));
    const cx = x + dateW + 6;
    const cw = cellW - 12;
    if (r.kind === "task") {
      parts.push(`<rect x="${cx}" y="${ry + 7}" width="${cw}" height="24" rx="6" fill="#7c3aed"/>`);
      parts.push(text(cx + 8, ry + 23, "Branding", { size: 12, weight: 600, fill: "#ffffff" }));
      parts.push(text(cx + cw - 8, ry + 22, "VARIANT", { size: 9, weight: 600, fill: "#ffffff", anchor: "end" }));
    } else if (r.kind === "requested") {
      parts.push(`<rect x="${cx}" y="${ry + 8}" width="${cw}" height="20" rx="6" fill="none" stroke="${C.emerald}" stroke-dasharray="3 2"/>`);
      parts.push(icon("tree-palm", cx + 7, ry + 12.5, 11, C.emeraldFg));
      parts.push(text(cx + 23, ry + 22, "Vacation requested", { size: 11, fill: C.emeraldFg }));
    } else if (r.kind === "hover") {
      parts.push(`<rect x="${cx}" y="${ry + 8}" width="${cw}" height="20" rx="6" fill="none" stroke="${C.brand}" stroke-dasharray="3 2"/>`);
      const label = "Request vacation";
      const lw = label.length * 5.9 + 16;
      const lx = cx + (cw - lw) / 2;
      parts.push(icon("tree-palm", lx, ry + 12.5, 11, C.brand));
      parts.push(text(lx + 16, ry + 22, label, { size: 11, fill: C.brand }));
    }
  });
  parts.push(`<rect x="${x + dateW}" y="${y}" width="1" height="${h}" fill="${C.border}"/>`);
  parts.push(`</g>`);
  parts.push(cursor(x + dateW + cellW / 2 + 30, y + 2 * rowH + 20));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" width="360" height="240" role="img" aria-label="Your column in the weekly plan: Monday shows a dashed Vacation requested, and the pointer is on Tuesday's dashed Request vacation button">\n` +
    parts.join("\n") +
    `\n</svg>\n`;
  writeFileSync("public/whats-new/1.76.0-vacation-plan.svg", svg);
}
console.log("wrote public/whats-new/1.76.0-vacation-card.svg and 1.76.0-vacation-plan.svg");
