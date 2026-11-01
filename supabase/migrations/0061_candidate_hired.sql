-- ── 0061: a hired candidate can become a team member ────────────────────────
--
-- `outcome = 'hired'` has existed since 0039, but nothing in the app could set
-- it, and a hire left no trail to the person they became (Nitsan, 2026-11-01).
--
-- ⚠️ HIRED AND ON THE TEAM ARE TWO FACTS, NOT ONE. A freelancer the studio
-- takes on (Milica) is hired and never gets an account; an employee is hired
-- AND gets a profile. So this is a nullable link, set only by "Add to the
-- team" (`/api/admin/users` with a `candidateId`) — never implied by the
-- outcome.
--
-- `on delete set null`: removing the profile must not take the hiring history
-- with it. The candidate stays hired; the link simply goes.
--
-- Optional for the app: every read and write of this column steps down when it
-- is missing, so it can run before or after the deploy. Safe to re-run.

alter table candidates
  add column if not exists profile_id uuid references profiles(id) on delete set null;
