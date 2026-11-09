# Reviewer brief — src/app sweep (report-only, 2026-11-08)

You are a READ-ONLY reviewer in a quality sweep of the studio-tracker app (Next.js 16 + React 19 +
Tailwind v4 + Supabase). **Do not edit, write or create any file**, and run no git command that changes
state. Read / Grep / read-only Bash only.

## Read first
- `CLAUDE.md` (repo root) — fully. The **UI conventions** bullet, the **Gotchas** list and the
  "Key components" bullet matter most here.
- `.simplify-repo/project.md` — rules a simplification must not break.
- `.simplify-repo/ledger.md` — the "Standards digest" (numbered rules).
- `.simplify-repo/exports.txt` — every exported symbol in `src/lib` (reuse targets). Shared UI pieces
  live in `src/components/ui.tsx`, `primitives.tsx`, `skeleton.tsx`, `empty-state.tsx`,
  `confirm-dialog.tsx` (`askConfirm`), `studio-arrow.tsx`, `resizable.tsx`, `mobile-sheet.tsx`.
- `docs/working-log.md` is huge — grep it (file/function name, or a version like v1.86.0) when code
  looks odd, instead of reading it.
- `.simplify-repo/report.md` (the `src/lib` sweep) and `.simplify-repo/report-components.md` (the
  `src/components` sweep). Don't re-report their items; DO report the `src/app` copies of things they
  name (month-name arrays, `d/m` formatters, inline task→client maps, `QUIET` field classes,
  `SortHeader`, the outside-click/Escape popover effect, hand-rolled sign-out).
- NEW since those sweeps: `askConfirm()` AND `askText()` live in `src/components/confirm-dialog.tsx`
  (use them for every native `confirm()` / `prompt()`; a copy-link `window.prompt` fallback after a
  clipboard failure is the one tolerated case); `fetchAllIn` in `db.ts` (chunked + paged `.in()`);
  `service()` in `src/lib/supabase/service.ts` builds the service-role client.

## src/app-specific rules
- Pages and routes have no unit tests; they're verified in the browser. A "safe simplification" must
  keep rendered markup, classes, HTTP status codes and JSON shapes identical — when in doubt, it's a
  behaviour-changing idea.
- **API routes:** every route checks the session except the token-gated public ones and the crons
  (CLAUDE.md "App structure"). Check each route's auth: who may call it, and that a 401/403 comes
  BEFORE any service-role read. Security boundaries — don't propose loosening: token gates,
  `report-sanitize` (server-side stripping), the upload allowlist (`src/lib/uploads.ts`), the
  `fetch-document.ts` URL guard, the intake rate limit, `CRON_SECRET`, the Gmail push secret, and
  `/api/log/[token]` selecting a freelancer's rate columns BY NAME (notes must never reach him).
  Report any missing/late auth check under BUGS.
- Routes that build the service-role client inline instead of `service()`, and inline admin checks
  (`role !== "admin"`) — a reuse finding; note per route but group the fix under CROSS-CUTTING.
- **Public token pages** (`report/`, `gantt/`, `estimate/`, `intake/`, `log/`) are seen by CLIENTS
  and freelancers; anything they render is client-facing. The report page ships a frozen, sanitized
  snapshot — never live data.
- `globals.css` (if yours) is the app-wide look; CLAUDE.md "Gotchas" describes its unlayered rules
  (cards lose outlines, dividers vanish outside real tables, text snaps to 11/12/13/14, the weekly-plan
  state treatments, `mask:` longhands only). Report only dead rules you can prove unused (grep the
  class/selector across src) and comments that disagree with the rules.
- UI conventions (CLAUDE.md): `StudioArrow` for every "go there" arrow, never lucide arrows; loading =
  `Skeleton*`/`LoadingLine`/`PageSkeleton`, never a "Loading…" line; empty list = `EmptyState`;
  confirmed write = `toast()`; `askConfirm()` never `window.confirm`/`confirm()` (the desktop pane
  answers native dialogs "no" instantly); `prefersReducedMotion()`; `liftDrag(e)` for draggable cards;
  `celebrate()` only for a deal won; lucide icons 20px strokeWidth 1.75 by default; anchored popovers
  are `fixed` + portalled + flipped; the z-scale table in `client-view/index.tsx`; `useHoursScope` in
  `dashboard/shared.ts` keeps admin and member charts agreeing.
- `globals.css` beats Tailwind utilities (see Gotchas) — don't call a class "redundant" without
  checking globals.css.
- In pages/components, data access belongs in `src/lib` (the store via `useData()`; leads/candidates/gmail fetch per page
  through `src/lib/<domain>/`). A component calling Supabase directly is an altitude finding unless
  CLAUDE.md says otherwise.
- `?viewAs=` preview is read-only via `store/preview-guard.ts`; don't route writes around the store.

## Five lenses
1. **Standards** — the digest + the UI conventions above.
2. **Reuse** — logic duplicating an existing helper (exports.txt, the shared UI pieces), constants
   restated (month names!), the same 5+ lines repeated across files. New shared helper only with 3+
   real call sites.
3. **Simplification** — dead code (unused components/exports/props/state/branches; **grep the WHOLE
   repo** `grep -rn name src scripts` incl. dynamic/string usage before calling anything unused),
   needless indirection, derivable state, redundant casts, nesting that flattens.
4. **Efficiency** — only clear local wins: work repeated per render that a `useMemo` already present
   could hold, O(n·m) lookups in render over big lists (tasks, entries), N+1 fetches.
5. **Altitude** — business rules in a component that belong in `src/lib`; Supabase calls from UI;
   god-components where a part has an obvious name; a missing why-comment on something surprising.

Hard rules: behaviour stays identical. Why-comments (⚠️ notes, version refs) are part of the code —
never propose deleting them. If code and docs disagree, report it, don't pick a side. Bugs you notice
go in BUGS with a one-line fix idea.

## Output — your final message is all I get; keep it under ~1200 words
One line per finding, exactly: `file:line — lens — what — fix — confidence(high/med)`
Under these headings:
- SAFE SIMPLIFICATIONS (for any "unused" claim, say what you grepped)
- BUGS NOTICED
- BEHAVIOUR-CHANGING IDEAS
- DOCS VS CODE DISAGREEMENTS
- CROSS-CUTTING
Then one line: `clean: a.tsx, b.tsx` for files with nothing worth changing. Fewer solid findings beat
many speculative ones. No preamble.
