// Draws the two v1.78.0 pictures for the what's-new panel.
//
//   (dev server running on :3000)  node scripts/build-whatsnew-refresh.mjs
//   → public/whats-new/1.78.0-new-look.png
//   → public/whats-new/1.78.0-undo.png
//
// ⚠️ A DIFFERENT ROUTE FROM THE OTHER build-whatsnew-* SCRIPTS, on purpose. They
// write SVG text by hand, and an SVG loaded through <img> cannot fetch a font —
// so they fell back to the system face. For the release that IS the new look,
// a picture in the wrong face would be the one thing wrong with it. So each
// picture is an HTML page laid out by Chrome and captured on a transparent
// background.
//
// ⚠️ THE NEW-LOOK SHOT IS THE APP'S OWN STYLESHEET ON THE APP'S OWN MARKUP.
// Pieces of the member Home — the identity (MemberWelcome), `MyWeek`
// (dashboard/member.tsx) and two stat tiles — with their class lists copied as
// rendered, floated at different depths on the panel's blue. The stylesheet is
// the dev server's, so the cards, Light White tiles, serif and arrow are the
// real rules, not my reading of them. If the components change, re-copy the
// classes. Two rejected tries, both Nitsan's call: a hand-copied "Hours by
// client" card ("isn't impressive or showing the new look"), then a flat slice
// of the Home page; of a phone shot and these floating pieces, he picked this.
// The toast is drawn from toaster.tsx's values with a little local CSS.
//
// ⚠️ THE CONTENT IS ILLUSTRATIVE — not anybody's real week, tenure or hours.
// Client names and colours are the clients' own, as in the earlier pictures.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (f) => pathToFileURL(resolve("public/brand/saans", f)).href;

const base = `
@font-face { font-family: Saans; src: url("${font("Saans-Regular.otf")}"); font-weight: 350 449; }
@font-face { font-family: Saans; src: url("${font("Saans-Medium.otf")}"); font-weight: 450 599; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 360px; height: 240px; background: transparent; overflow: hidden; }
body { font-family: Saans, system-ui, sans-serif; font-weight: 380; color: #06112f;
  display: flex; align-items: center; justify-content: center; -webkit-font-smoothing: antialiased; }
.num { font-variant-numeric: tabular-nums; }
`;

/* ── 1. The new look: pieces of a designer's Home, floating ──────────────── */
// ⚠️ Laid out at 1080px so the `md:` rules apply (the week is a 5-up grid
// there, a scrolling row below it), then zoomed ×2 onto a 540×360 stage.
// ⚠️ The group is scaled to 90% about its centre so every shadow clears the
// edge: a drop shadow that reaches the picture's edge is cut there, and on the
// blue the cut reads as a pale box. Moving the pieces inward instead made them
// cover each other (My hours over the Weekly plan link).
const appCss = (() => {
  const html = execFileSync("curl", ["-s", "http://localhost:3000/login"], { encoding: "utf8" });
  const href = /href="(\/_next\/static\/[^"]+\.css)"/.exec(html)?.[1];
  if (!href) throw new Error("No stylesheet found — is the dev server running on :3000?");
  // Inlined, not linked: a file:// page in headless Chrome did not apply the
  // linked sheet. ⚠️ Its root-relative urls (the fonts) are pointed at the
  // FILES in public/, not at the server — a font fetched cross-origin from a
  // file:// page is refused, and the shot silently falls back to the system face.
  const pub = pathToFileURL(resolve("public")).href;
  return execFileSync("curl", ["-s", `http://localhost:3000${href}`], { encoding: "utf8", maxBuffer: 1 << 26 })
    .replace(/url\((["']?)\//g, `url($1${pub}/`);
})();
const ARROW = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="butt" stroke-linejoin="miter" class="shrink-0"><path d="M2.5 12.6 C7.5 11.7 13 11.7 19 12"/><path d="M12.6 4.8 C15.4 6.9 18 9.5 20.2 12 C18 14.5 15.4 17.1 12.6 19.2"/></svg>`;
const chip = (label, color) =>
  `<button class="bidi-auto block max-w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-white" style="background-color:${color}">${label}</button>`;
const absence = (label) => `<span class="truncate rounded px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600">${label}</span>`;
const NOTRAFFIC = "#0083e1";
const VARIANT = "#7c3aed";
const DUALBIRD = "#ff673e";
const week = [
  { d: "Sun", n: 18, items: [chip("Homepage", NOTRAFFIC), chip("Brand book", VARIANT)] },
  { d: "Mon", n: 19, items: [chip("Homepage", NOTRAFFIC)] },
  { d: "Tue", n: 20, today: true, items: [chip("Pitch deck", DUALBIRD), chip("Homepage", NOTRAFFIC)] },
  { d: "Wed", n: 21, items: [absence("Vacation")] },
  { d: "Thu", n: 22, items: [chip("Brand book", VARIANT)] },
];
const day = (w) =>
  `<div class="flex min-h-[132px] w-64 shrink-0 grow gap-2 rounded-xl border p-2.5 md:w-auto md:grow-0 md:flex-col md:gap-1 ${
    w.today ? "border-brand bg-brand text-white" : "border-border bg-background"
  }"><div class="flex min-w-0 flex-1 flex-col md:contents"><span class="text-[10px] font-semibold uppercase tracking-wide ${
    w.today ? "text-white/80" : "text-faint"
  }">${w.d}</span><span class="text-base font-bold leading-none">${w.n}</span></div><div class="flex w-4/5 shrink-0 flex-col gap-1 md:mt-1 md:w-auto">${w.items.join("")}</div></div>`;
const myWeek = `<div class="rounded-2xl border border-border bg-surface p-4 shadow-card"><div class="mb-3 flex items-center justify-between"><h2 class="font-heading text-sm">My week</h2><a class="flex items-center gap-1 text-xs text-brand">Weekly plan ${ARROW}</a></div><div class="-mx-1 flex gap-2 overflow-x-auto px-1 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">${week.map(day).join("")}</div></div>`;
const tile = (label, fig, unit, foot) =>
  `<div class="rounded-2xl border p-4 shadow-card border-border bg-surface"><div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">${label}</div><div class="mt-1.5 font-serif-accent text-[32px] leading-none"><span class="tabular-nums">${fig}</span><span class="text-xl">${unit}</span></div><div class="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted">${foot}</div></div>`;
const identity = `<div class="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card"><span class="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0" style="width:40px;height:40px;font-size:15.2px;background-color:#7c3aed">N</span><div><p class="text-xs text-muted">Tuesday, 20/10</p><div class="font-serif-accent text-[24px] leading-7">Nadav</div></div></div>`;
const newLook = `<!doctype html><html data-theme="electric" class="antialiased"><meta charset="utf-8">
<style>${appCss}</style>
<style>
/* ⚠️ next/font defines --font-rubik on <html>. Undefined, it voids every font
   stack that names it and the shot falls back to the system face. */
html { --font-rubik: "Rubik"; }
html, body { width: 1080px; height: 720px; margin: 0; background: transparent !important; overflow: hidden; }
/* Inside .app-canvas, or the electric rules (no outline, Light White) don't apply. */
.stage { zoom: 2; position: relative; width: 540px; height: 360px; transform: scale(0.9); }
.p { position: absolute; filter: drop-shadow(0 12px 18px rgba(6, 17, 47, 0.26)); }
</style>
<body><div class="app-canvas"><div class="stage">
<div class="p" style="left:14px;top:112px;width:400px">${myWeek}</div>
<div class="p" style="left:352px;top:8px;width:170px">${tile("My hours", "118", "h", `<span class="rounded-md px-1.5 py-0.5 font-semibold tabular-nums bg-success/10 text-success">▲ 6%</span><span>vs last</span>`)}</div>
<div class="p" style="left:392px;top:220px;width:136px">${tile("Billable", "91", "%", "<span>this month</span>")}</div>
<div class="p" style="left:24px;top:22px">${identity}</div>
</div></div></body></html>`;

/* ── 2. Undo, straight after logging ────────────────────────────────────── */
// The Toaster at life size: navy note, the green disc with its drawn tick,
// the text, Undo in aqua (shown HOVERED, with the pointer on it — the gesture,
// not the outcome), ✕, and the aqua timer line part-way run down.
const undo = `<!doctype html><meta charset="utf-8"><style>${base}
.toast { position: relative; display: flex; width: max-content; white-space: nowrap; align-items: center; gap: 12px; overflow: hidden;
  border-radius: 12px; background: #06112f; padding: 12px 8px 12px 14px; color: #fff; font-size: 14px; line-height: 20px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35); }
.tick { display: flex; width: 24px; height: 24px; flex: none; align-items: center; justify-content: center; border-radius: 999px; background: #16a34a; }
.undo { position: relative; flex: none; border-radius: 6px; padding: 4px 10px; font-weight: 570; color: #74f3ef; background: rgba(255,255,255,.1); }
.x { flex: none; border-radius: 6px; padding: 4px 6px; color: rgba(255,255,255,.5); }
.timer { position: absolute; left: 0; bottom: 0; height: 2px; width: 58%; background: #74f3ef; }
.cursor { position: absolute; left: 30px; top: 16px; }
</style><div class="toast">
<span class="tick"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="butt" stroke-linejoin="miter"><path d="M4 12.5 L9.5 18 L20 6.5"/></svg></span>
<span>Logged 2h on Anchor · Homepage</span>
<span class="undo">Undo<svg class="cursor" width="16" height="22" viewBox="-1 -1 15 20"><path d="M0 0 L0 15.5 L4.1 11.6 L6.7 17.5 L9.5 16.2 L6.9 10.5 L12.4 10.3 Z" fill="#06112f" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg></span>
<span class="x">✕</span>
<span class="timer"></span>
</div>
<script>
// Life size is wider than the panel's 360px, so the whole note shrinks to fit —
// measured once the face has loaded, since Saans and the fallback differ.
document.fonts.ready.then(() => {
  const t = document.querySelector(".toast");
  t.style.zoom = Math.min(1, 328 / t.offsetWidth);
});
</script>`;

const dir = mkdtempSync(join(tmpdir(), "whatsnew-"));
try {
  for (const [name, html, size, scale] of [
    ["1.78.0-new-look", newLook, "1080,720", "1.5"],
    ["1.78.0-undo", undo, "360,240", "2"],
  ]) {
    const page = join(dir, `${name}.html`);
    writeFileSync(page, html);
    execFileSync(CHROME, [
      "--headless=new",
      "--hide-scrollbars",
      `--force-device-scale-factor=${scale}`,
      "--default-background-color=00000000",
      `--window-size=${size}`,
      // time for the fonts and the stylesheet to load before the shot
      "--virtual-time-budget=4000",
      `--screenshot=${resolve("public/whats-new", `${name}.png`)}`,
      pathToFileURL(page).href,
    ], { stdio: "ignore" });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
