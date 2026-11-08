# simplify-repo — project settings (studio-tracker)

Derived 2026-11-08 from CLAUDE.md, AGENTS.md, eslint.config.mjs, tsconfig.json,
package.json. CLAUDE.md always wins over this file.

## Exclusions

- exclude: `src/lib/version.ts`
- exclude: `src/lib/whats-new.ts`
- exclude: `supabase/migrations/*`
- exclude: `data/*`
- exclude: `public/*`

Why: `version.ts` is bumped by the release loop only. `whats-new.ts` is release
copy the team reads (its type/helpers are trivial; the bulk is prose, with its
own style rules in the header). Migrations 0001–0063 are applied — never edit.
`data/` is real client data + one-off SQL. `about-data.json` is GENERATED
(`scripts/build-about-stats.mjs`) and is already skipped as JSON.

Test files (`*.test.ts`) ARE in scope, with a light touch: dead code and
duplicated fixtures only — never remove, loosen or merge an assertion.

## Standards greps (run once in Phase 1)

```bash
# No millisecond date arithmetic — use shiftDays/daysBetween (CLAUDE.md gotchas, v1.23.0)
grep -rnE "86_?400_?000|24 \* 60 \* 60" src --exclude='*.test.ts'
# Date strings via format.ts helpers, not toISOString().slice (UTC shifts the day in Israel)
grep -rnE "toISOString\(\)\.(slice|substring|split)" src --exclude='*.test.ts'
# window.confirm is dead in the preview pane — use askConfirm() (v1.63.0)
grep -rnE "window\.confirm|[^.a-zA-Z]confirm\(" src --exclude='*.test.ts'
# Missing-schema step-down goes through isMissingSchema / MISSING_SCHEMA_CODES (db.ts)
grep -rnE "\"(PGRST204|42703|42P01|PGRST205)\"" src --exclude='*.test.ts'
# Reduced motion via prefersReducedMotion() (lib/reduced-motion.ts)
grep -rn "prefers-reduced-motion" src --exclude='*.test.ts'
# Leads queries must filter soft-deleted rows (v1.63.1)
grep -rn 'from("leads")' src
# No "go there" lucide arrows — StudioArrow (UI conventions)
grep -rnE "\b(ArrowRight|ArrowUpRight)\b" src
# No "Loading…" lines — Skeleton / LoadingLine (UI conventions)
grep -rnE "Loading(…|\.\.\.)" src
# `any` only at the DB boundary, with a reason
grep -rnE ": any\b|as any\b|@ts-ignore|eslint-disable" src --exclude='*.test.ts'
```

## Rules a "simplification" must not break

- Missing-schema step-downs (`isMissingSchema`, `updateWithOptional`, optional
  selects) look redundant but keep the app alive before a migration is run.
  Only ever step down on a missing-schema code, never on any error.
- `fetchAll` paging (ordered by `id`) exists because PostgREST silently caps at
  1000 rows — never "simplify" back to a plain select.
- No ms date maths; `period-math.ts` functions all take `now` on purpose.
- `entrySums` excludes legacy rows, `entrySumsAll` includes them — not dupes.
- 0011 trigger names protected task columns; `?viewAs=` read-only guard
  (`store/preview-guard.ts`) blocks by default — don't route writes around it.
- `@/lib/store` exports only `DataProvider, useData, useDataMaybe, useIsAdmin,
  TaskRequest`; domains reach each other via `methodsRef`. Leads, candidates and
  gmail are deliberately NOT in the store (egress).
- Server-only code (service key, `supabase/service.ts`, `advice/run.ts`,
  `hours-goal-server.ts`, `gmail/*`) must not become reachable from client code.
- &advice: no amounts leave the server — the P&L is one ratio in `signals.ts`.
  Client hours use Client Reports' set; pace uses Home's even spread.
- Report snapshots are sanitized server-side; `report-sanitize.ts` strips data
  physically — don't move stripping to the client.
- `fetch-document.ts` public-https / `%PDF-` guard is a security boundary.
- Why-comments (⚠️ notes, version references) stay. Repo is hand-formatted at
  ~100 cols — don't run prettier.
- Names mentioned in CLAUDE.md (useHoursScope, shiftDays, fetchAll,
  isMissingSchema, updateWithOptional, studioDayLogged, toast, askConfirm…)
  don't get renamed.

## Verify

- **Per batch (fast):** `npx tsc --noEmit`; `npx eslint <touched files>` at 0
  errors (warnings are a baseline — compare like with like);
  `npm test -- <nearest test files>`. Node 24 PATH prefix for npx.
- **Full (Phase 3):** `npx tsc --noEmit`, `npx eslint src`, `npm test`,
  `NEXT_BUILD_DIR=.next-build npm run build` (watch for new `○` pages).
- **Visual:** components + store DB paths aren't unit tested — check touched
  pages in the preview (`studio-tracker` launch config) at desktop and 375px.

## Shipping

Commit on `main` (the project's only branch). A sweep that changes code is a
release only when Nitsan says "publish it": then bump `APP_VERSION` (patch),
add a `docs/working-log.md` entry at the top, run the four gates, one push.
Never push per batch. Commit messages via `-F file`, one git action per call.
