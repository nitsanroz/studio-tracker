-- ── 0063: a freelancer's details — website, where they work from, notes ─────
--
-- Nitsan, 2026-11-05: the freelancer page should hold their details "so it's
-- organized". Email and phone already have a home — `member_hr.personal_email`
-- / `member_hr.phone` (admin-only; a candidate's "Convert to a freelancer"
-- fills them, and finance-admin's person page shows them). The rest lives on
-- the freelancer's own row:
--
--   website  — portfolio or site
--   location — country / city, free text
--   notes    — anything else (how they invoice, time zone…)
--
-- ⚠️ PRIVATE TO ADMINS. `freelancers` is admin-only RLS with no "read all"
-- (0054), and the freelancer's own link (/api/log/[token]) selects only the
-- rate columns BY NAME — keep it that way, or notes reach the freelancer.
--
-- Optional for the app: without it the page shows email and phone only and
-- says this needs running. Safe to re-run.

alter table freelancers add column if not exists website text;
alter table freelancers add column if not exists location text;
alter table freelancers add column if not exists notes text;
