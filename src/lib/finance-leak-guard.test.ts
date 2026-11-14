import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_COLUMNS } from "./snapshot";

/**
 * Structural guards for the finance merge: rules about WHERE money may live,
 * checked by reading the source rather than by remembering.
 *
 *  1. Client code never imports a module that carries amounts.
 *  2. Finance code never reaches for the service key — it reads with the
 *     viewer's own session, so RLS stays the boundary.
 *  3. The boot snapshot never asks for a profile column it doesn't show.
 */
const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));
const isClient = (f: { path: string; text: string }) =>
  /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(f.text) || f.path.startsWith("components/");
const imports = (text: string, module: string) =>
  new RegExp(`from\\s+["'][^"']*${module}["']|import\\(\\s*["'][^"']*${module}["']`).test(text);

/** Modules holding ₪ figures or rates. Server code only. */
const AMOUNT_MODULES = [
  "lib/hours-goal", // a freelancer's sliding ₪ rate, the target margin
  "lib/hours-goal-server",
  "lib/finance/accountant-years", // the accountant's yearly figures
  "lib/finance/scenarios/facts", // balance-sheet and loan figures
];

describe("finance leak guards", () => {
  it("found the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(isClient)).toBe(true);
  });

  it("keeps amount-carrying modules out of client code", () => {
    const offenders = files
      .filter(isClient)
      // by file name: "@/lib/hours-goal" and "./hours-goal" both end in "/hours-goal",
      // and the closing quote keeps "hours-goal-server" from matching "hours-goal"
      .flatMap((f) =>
        AMOUNT_MODULES.filter((m) => imports(f.text, "\\/" + m.split("/").pop()!)).map((m) => `${f.path} → ${m}`),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps the service key out of finance code", () => {
    const offenders = files
      .filter((f) => /^(lib|components)\/finance\//.test(f.path) || /^app\/(\(app\)\/finance|api\/finance)\//.test(f.path))
      .filter((f) => imports(f.text, "supabase\\/service") || /SUPABASE_SERVICE_ROLE_KEY/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("asks the boot snapshot only for the profile columns it shows", () => {
    const cols = PROFILE_COLUMNS.split(",").map((c) => c.trim());
    expect(cols).not.toContain("finance_full_access");
    expect(cols).not.toContain("*");
    // every column the mapper reads is asked for
    const mapper = /export const mapProfile[\s\S]*?\n\}\);/.exec(readFileSync(join(SRC, "lib/db.ts"), "utf8"))?.[0] ?? "";
    const read = [...mapper.matchAll(/\br\.([a-z_]+)/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(5);
    expect([...new Set(read)].sort()).toEqual([...cols].sort());
  });
});
