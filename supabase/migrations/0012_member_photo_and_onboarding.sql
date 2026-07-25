-- ── 0012: homepage photo + HR onboarding state ─────────────────────────────
-- Two separate images per member:
--   avatar_url  — small round avatar (initials / graphic / headshot), existing
--   photo_url   — the studio cut-out portrait (head-to-arms, white studio&more
--                 tee) used on the member home hero + team cards
alter table profiles add column if not exists photo_url text;

-- Tracks whether the member has been through the "confirm your details" step
-- that runs on first sign-in. Null = never completed.
alter table member_hr add column if not exists confirmed_at timestamptz;

-- member_hr stays ADMIN-ONLY at the RLS level on purpose: it holds salary.
-- Members read/write their own non-salary fields through /api/me/hr, which is
-- session-verified and whitelists columns server-side (salary is never
-- returned to, or writable by, a member).
