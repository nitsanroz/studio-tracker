import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_COLUMNS } from "./snapshot";

/**
 * Structural guards for the finance merge: rules about WHERE money may live,
 * checked by reading the source rather than by remembering.
 *
 *  1. No module that carries amounts is reachable from client code, at any depth.
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
const byPath = new Map(files.map((f) => [f.path, f]));
const directive = (text: string, d: string) =>
  new RegExp("^\\s*(\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*[\"']" + d + "[\"']").test(text);
const imports = (text: string, module: string) =>
  new RegExp("from\\s+[\"'][^\"']*" + module + "[\"']|import\\(\\s*[\"'][^\"']*" + module + "[\"']").test(text);

/** The files a file pulls in at RUNTIME — \`import type\` is erased, so it doesn't count. */
function valueImports(file: { path: string; text: string }): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const m of file.text.matchAll(re)) {
    if (m[1]) continue; // import type … / export type …
    specs.push(m[2] ?? m[3] ?? m[4]);
  }
  const dir = file.path.split("/").slice(0, -1).join("/");
  return specs.flatMap((spec) => {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = join(dir, spec);
    else return []; // a package
    const hit = [base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx", base].find((p) => byPath.has(p));
    return hit ? [hit] : [];
  });
}

/**
 * Everything that ends up in a browser bundle: each "use client" file and
 * whatever it imports, to any depth. A "use server" file stops the walk — the
 * client holds only a reference to its actions, never its code.
 *
 * ⚠️ To any depth is the point. The first version looked one hop, and missed
 * finance's \`overview.ts\`: not a client file itself, but imported by client
 * pages, and carrying a freelancer's rate into their JavaScript.
 */
function clientBundle(): Map<string, string> {
  const via = new Map<string, string>();
  const queue = files.filter((f) => directive(f.text, "use client")).map((f) => f.path);
  for (const p of queue) via.set(p, p);
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of valueImports(byPath.get(path)!)) {
      if (via.has(next) || directive(byPath.get(next)!.text, "use server")) continue;
      via.set(next, path);
      queue.push(next);
    }
  }
  return via;
}

/** Modules holding ₪ figures or rates. Server code only. */
const AMOUNT_MODULES = [
  "lib/hourly-terms.ts", // a freelancer's sliding ₪ rate
  "lib/hours-goal-server.ts",
  "lib/finance/accountant-years.ts", // the accountant's yearly figures
  "lib/finance/scenarios/facts.ts", // balance-sheet and loan figures
];

/** Modules holding a personal detail — an address, what the owner calls people. Server code only. */
const PRIVATE_MODULES = [
  "lib/finance/mail/rent-private.ts", // the owner's home building
  "lib/finance/scenarios/nicknames.ts", // the owner's names for people
];

describe("finance leak guards", () => {
  const bundle = clientBundle();

  it("found the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(bundle.size).toBeGreaterThan(100);
    for (const m of [...AMOUNT_MODULES, ...PRIVATE_MODULES]) expect(byPath.has(m), m).toBe(true);
    // the walk really follows imports: the pace chart reaches even-spread.ts
    expect(bundle.has("lib/even-spread.ts")).toBe(true);
  });

  it("keeps amount-carrying modules out of every browser bundle", () => {
    const chain = (p: string): string => {
      const from = bundle.get(p)!;
      return from === p ? p : chain(from) + " → " + p;
    };
    expect(AMOUNT_MODULES.filter((m) => bundle.has(m)).map(chain)).toEqual([]);
  });

  it("keeps personal details out of every browser bundle", () => {
    const chain = (p: string): string => {
      const from = bundle.get(p)!;
      return from === p ? p : chain(from) + " → " + p;
    };
    expect(PRIVATE_MODULES.filter((m) => bundle.has(m)).map(chain)).toEqual([]);
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
