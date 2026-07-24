# Studio Tracker — Fix Plan

Derived from the 4 reviews (UX · Code · Security · Studio-manager), 2026-07-24.

**Decisions locked with owner:**
- Scope = **everything**, including the product gaps (notifications + capacity view).
- Member hours = **shared visibility is fine** → *document as accepted*, do not restrict reads.
- Privileged writes = enforce via **tightened DB RLS** (triggers where column-level rules are needed).

**Ground rules**
- Migrations are written here but **applied by Nitsan in the Supabase SQL editor**. Each is flagged *apply-before-deploy* or *apply-after*.
- Work on a branch; bump `APP_VERSION` (`src/lib/version.ts`) on every deploy; append to the CLAUDE.md working log.
- Effort: S ≈ <½ day · M ≈ ½–1 day · L ≈ multi-day. Risk = chance of breaking prod.

---

## Phase 0 — Pre-flight (S, do first)
- [ ] Branch off `main`; confirm clean build with Node 24 PATH.
- [ ] Take a Supabase backup / note current schema before any migration.
- [ ] Confirm exact `tasks` column names against `src/lib/types.ts` + schema (the trigger below assumes `name, budget_hours, due_date, billable, completed, client_id, section_id, assignee_id` — **verify before running**).

---

## Phase 1 — Security-critical  *(before sharing any new report link or wider release)*

> **STATUS 2026-07-24 (v0.99.3, built, not yet deployed):** 1.1 ✅ · 1.2 ✅ (migration 0011 written — **apply in Supabase before deploy**) · 1.3 ✅ · 1.4 ✅ (core CVEs; residual transitive `sharp`/`postcss` highs tracked) · 1.5 ✅ (allowlist + rate limit done; **private-bucket + signed URLs deferred** — needs intake-queue render change) · 1.6 partial (shared-hours + errors documented; **`git rm --cached data/` and `middleware.ts` still open**). Remaining before "done": apply 0011, deploy, then close the two 1.6 items.

### 1.1 Public-report leak — HIGH  (M, risk: med)
Client can currently unhide admin-hidden rows/columns because the full snapshot ships to the browser and hiding is client-side (`public-report-view.tsx:104-113`, `editable={reveal}`).
- [ ] In `src/app/report/[token]/page.tsx`: strip `hiddenTaskIds` / `hiddenColumns` (and any other client's data) from the snapshot **server-side** before passing to the client component.
- [ ] In `src/components/public-report-view.tsx`: remove the "Show hidden rows" toggle entirely.
- [ ] Verify: open a published report URL, confirm hidden rows are absent from the network payload (not just visually hidden).

### 1.2 Task-write RLS — HIGH  (M, risk: med) → **migration 0011**
Replace the wide-open update policy with a role-aware, column-guarding trigger.
- [ ] Add `WITH CHECK (auth.uid() is not null)` to the update policy.
- [ ] Add `BEFORE UPDATE` trigger blocking non-admins from changing protected columns:

```sql
-- 0011_harden_task_writes.sql   (APPLY BEFORE DEPLOY — verify column names first)
create or replace function enforce_task_member_columns()
returns trigger language plpgsql security definer as $$
begin
  if is_admin() then return new; end if;
  if new.name        is distinct from old.name
  or new.budget_hours is distinct from old.budget_hours
  or new.due_date    is distinct from old.due_date
  or new.billable    is distinct from old.billable
  or new.completed   is distinct from old.completed
  or new.client_id   is distinct from old.client_id
  or new.section_id  is distinct from old.section_id
  or new.assignee_id is distinct from old.assignee_id
  then
    raise exception 'members cannot modify protected task fields';
  end if;
  return new;   -- tags / figma_url / position still allowed
end $$;

drop trigger if exists trg_task_member_cols on tasks;
create trigger trg_task_member_cols before update on tasks
  for each row execute function enforce_task_member_columns();
```
- [ ] Verify: as a non-admin (use `?viewAs` won't test RLS — use a real member login or the anon key), attempt a direct Supabase update of `budget_hours` → must be rejected; updating `tags` → succeeds. Admin edits unaffected.

### 1.3 Attachment API ownership — HIGH  (S, risk: low)
`src/app/api/task-attachments/route.ts` runs POST/DELETE with the service-role client after only checking sign-in → IDOR.
- [ ] Before the service-role write/delete, verify the caller is admin **or** owns the target (attachment `uploaded_by = user`, or the task belongs to them). Reject otherwise with a generic 403.
- [ ] Verify: member A cannot delete member B's attachment by id.

### 1.4 Next.js upgrade — HIGH  (S, risk: med)
3 high-severity advisories (SSRF, App-Router DoS, internal endpoint disclosure; vulnerable bundled postcss/sharp).
- [ ] `next@16.2.11` (or latest patched 16.x). Re-read `node_modules/next/dist/docs/` for any breaking notes (per AGENTS.md this Next differs from training data).
- [ ] Full local build + smoke test, then deploy; run `npm audit` to confirm highs cleared.

### 1.5 Intake / public-bucket hardening — MEDIUM  (M, risk: low)
`api/intake/[token]` (+ `api/avatar`, `api/task-attachments`) accept attacker-controlled `contentType` into a **public** bucket, no rate limit.
- [ ] Allowlist content types (images/pdf) or force `Content-Disposition: attachment`.
- [ ] Move intake files to a **private** bucket, serve via signed URLs.
- [ ] Add basic rate limiting / minimal bot check on the intake POST (protects storage, DB rows, Resend cost).

### 1.6 Document accepted decisions — LOW  (S)
- [ ] Note in CLAUDE.md (and a short `SECURITY.md`): studio-wide hours/tasks read visibility is **intentional**; genuinely sensitive tables (`member_hr`, `member_notes`, `finance_*`, `client_billing_periods`) remain admin-only.
- [x] Return generic error messages instead of raw `error.message` (intake/avatar/attachments done).
- **Decision 2026-07-24:** `data/` in git → **leave as-is** (repo stays private). `server.ts` middleware comment → **leave as-is** (auth enforced by layout + RLS; not worth the change).

---

## Phase 2 — Data integrity & code correctness

> **STATUS 2026-07-24 (v0.99.4, built, not yet deployed):** 2.1 ✅ (safe-write banner) · 2.2 ✅ (lint 61 errors → **0 errors / 56 warnings**; all `any` fixed; React-Compiler rules set to warn). **Deferred:** 2.3 (position helper), 2.4 (schema-shim removal — touches boot path), 2.5 (Vitest). **Manual check:** exercise the write-error banner once logged in.

### 2.1 Safe writes — CRITICAL  (M, risk: low)
Every mutation is fire-and-forget with silent failure (`store.tsx`, ~30 sites). For a billing source-of-truth, a dropped write can go unnoticed for a week.
- [ ] Add a `withWrite(optimisticApply, revert, dbCall)` helper: on Supabase error → revert local state + surface a visible toast/banner. Roll out to all mutations, starting with time-entry and billable/budget edits.

### 2.2 Green the lint + fix the real bug — CRITICAL  (S)
`npx eslint src` = 61 errors; includes a genuine `set-state-in-effect` at `store.tsx:218` (`setViewAsKey(null)` synchronously in an effect).
- [ ] Fix the effect (guard/setState-in-callback). Resolve/relax the `no-explicit-any` mass in `store.tsx` + `db.ts` (type the Supabase row mappers). Get `npm run lint` passing and make it a pre-deploy gate.

### 2.3 Position-race helper — SHOULD FIX  (S)
"Next position" is duplicated 6× and computed from stale client state → simultaneous inserts collide.
- [ ] Extract one helper; longer-term give the column a DB default/sequence.

### 2.4 Delete dead schema shims — SHOULD FIX  (S)
`store.tsx:308-353` has compat fallbacks for migrations already applied in prod (≤0010).
- [ ] Remove once confirmed; simplifies the hot load path.

### 2.5 Testing foundation — CRITICAL gap  (L)
Zero tests today.
- [ ] Add Vitest. Cover the highest-risk pure logic first: `aggregate.ts`, `date-ranges.ts`, `report-snapshot.ts`, `weekly-plan-sync.ts` (the destructive clear→insert), and undo/redo inverse patches in `store.tsx`.

### 2.6 (Opportunistic) split God-context — NICE  (L)
`store.tsx` (1453 lines) re-renders every consumer on any change. Split by domain (tasks / plan / billing / dev) as files are touched — not a standalone sprint.

---

## Phase 3 — UX

### 3.1 Text contrast — CRITICAL  (M)
`--faint (#98a0b3)` ≈ 2.6:1 on `#fafafa`, used **207×** for real content (fails WCAG AA).
- [ ] Reclassify load-bearing text (empty states, stat subtitles, header counts) → `--muted` (~5.9:1, passes). Reserve `--faint` for truly decorative use. Sweep `globals.css` + usages.

### 3.2 Intake form resilience — SHOULD FIX  (M)
One long ~15-field form, no grouping/autosave — the client's first touchpoint.
- [ ] Group into sections (Contact / Task / Brief / Files); autosave to `localStorage` keyed by token so a closed tab doesn't lose everything.

### 3.3 Edit affordance + consolidation — SHOULD FIX  (M)
- [ ] Give `editable-cell.tsx` a persistent subtle cue (not hover-only).
- [ ] Consolidate the 4 "log time" UIs (`CellDetails`, `UserDayDetails`, `AddTimePopover`, timer widget) into one shared component so field order/behavior match.

### 3.4 Clarity + polish — SHOULD FIX / POLISH  (S)
- [ ] Explain the Feed vs Timesheet toggle inline. Friendly error layer for `login`/`reset` (pairs with 1.6). Icon buttons: add visible labels or aria for touch. Reduce tooltip-only explanations on column headers.

### 3.5 Responsive — decide scope  (M, optional)
No layout below ~900px (`app-shell.tsx` fixed `w-52`, fixed-width tables).
- **Decision (2026-07-24): desktop-only is acceptable — mobile is out of scope for now.** Skip.

---

## Phase 4 — Product gaps (studio-manager dealbreakers)

### 4.1 Notifications / digest — DEALBREAKER  (M→L)
Today nothing pulls people back in. Resend + Vercel cron are already wired (see `plan-sync` cron pattern).
- [ ] Start with a **daily email digest** per user: your due/overdue tasks, over-budget tasks, unassigned-to-you, new intake submissions. Cheap, high-leverage.
- [ ] Then in-app notifications (assignment, due-soon, over-budget).

### 4.2 Forward capacity view — DEALBREAKER  (L)
`capacityHoursWeek` is only used for a personal daily target today.
- [ ] Build a manager view: per-person **capacity vs planned vs logged** for this/next week (feeds off the weekly plan + time entries), with over/under-allocated flags. This is the core of Sunday planning.

### 4.3 Stretch — GAPS  (M each)
- [ ] Global search (tasks/clients omnibox). "Due / at-risk this week" attention surface. Richer task status beyond todo/in-progress/done if multi-stage engagements need it.

---

## Recommended order & gates
1. **Phase 1 (all)** — ship as one security release; gate: hidden data not in report payload, member can't edit protected task fields or others' attachments, `npm audit` clean.
2. **Phase 2.1 + 2.2** — safe writes + green lint (protects the billing data) — ship next.
3. **Phase 3.1** — contrast (quick, high visible win).
4. **Phase 4.1** — daily digest (biggest adoption lever).
5. Remaining 2.x / 3.x / 4.2 as capacity allows; 2.5 (tests) runs alongside everything.

Each shipped phase: bump `APP_VERSION`, deploy, append to CLAUDE.md working log.
