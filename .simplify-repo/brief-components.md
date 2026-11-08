# Reviewer brief — src/components sweep (report-only, 2026-11-08)

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
- `.simplify-repo/report.md` — the earlier `src/lib` sweep. Don't re-report its items; DO report the
  component-side copies of things it names (e.g. month-name arrays, a `d/m` formatter, a
  `daysBetween` copy, inline task→client maps).

## Component-specific rules
- **Components have no unit tests**; they're verified in the browser. So a "safe simplification" here
  must keep the rendered markup, classes and behaviour identical — when in doubt, it's a
  behaviour-changing idea, not a simplification.
- UI conventions (CLAUDE.md): `StudioArrow` for every "go there" arrow, never lucide arrows; loading =
  `Skeleton*`/`LoadingLine`/`PageSkeleton`, never a "Loading…" line; empty list = `EmptyState`;
  confirmed write = `toast()`; `askConfirm()` never `window.confirm`/`confirm()` (the desktop pane
  answers native dialogs "no" instantly); `prefersReducedMotion()`; `liftDrag(e)` for draggable cards;
  `celebrate()` only for a deal won; lucide icons 20px strokeWidth 1.75 by default; anchored popovers
  are `fixed` + portalled + flipped; the z-scale table in `client-view/index.tsx`; `useHoursScope` in
  `dashboard/shared.ts` keeps admin and member charts agreeing.
- `globals.css` beats Tailwind utilities (see Gotchas) — don't call a class "redundant" without
  checking globals.css.
- Data access belongs in `src/lib` (the store via `useData()`; leads/candidates/gmail fetch per page
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
