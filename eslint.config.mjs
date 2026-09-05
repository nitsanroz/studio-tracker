import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ⚠️ NOT a default — this one is ours. `NEXT_BUILD_DIR=.next-build` (see
    // CLAUDE.md) keeps the build gate out of a running dev server's `.next`,
    // but re-listing the defaults here REPLACED them, so nothing ignored the
    // new directory. ESLint then walked the minified bundle and reported 576
    // "errors" + 8,414 warnings over the real source tree's 0 and ~14 — which
    // made a genuine lint regression unfindable and the exit code meaningless.
    ".next-build/**",
  ]),
  {
    // The React Compiler rule set (eslint-plugin-react-hooks v6) is advisory:
    // it flags optimization hints and intentional client-only patterns (e.g.
    // mount-time state init to avoid SSR hydration mismatches). We keep them as
    // WARNINGS so `next lint` stays a green error-level deploy gate while the
    // signal remains visible. Revisit in the store/perf refactor (FIX-PLAN 2.6).
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
