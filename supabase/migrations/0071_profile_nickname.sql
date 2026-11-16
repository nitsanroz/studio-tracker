-- ── 0071: a person's nickname — the name the studio calls them by ─────────
--
-- Nitsan, 2026-11-16: freelancers are known by a short name — Milica, Kate,
-- Ab, Dmitry — and that is the name the weekly plan and every assignment
-- should show, not "Abolfazl Babaei". `name` stays the full name (their own
-- page, Freelancers, finance, published reports); `nickname`, when set, is what
-- the app shows everywhere else (`mapProfile` in src/lib/db.ts).
--
-- On the PROFILE, not on `freelancers`: that table is admin-only (0054), and
-- the plan and the task lists are read by every member. A nickname is no more
-- private than a name, so it is readable like one — and writable like one: it
-- is NOT added to 0068's member list, so a member may set their own, exactly as
-- they may change their own `name`. Admins set it on a freelancer's page.
--
-- Optional for the app: before this runs the boot query falls back to "*" and
-- nobody has a nickname. Safe to re-run; no deploy order.

alter table profiles add column if not exists nickname text;

alter table profiles drop constraint if exists profiles_nickname_length;
alter table profiles add constraint profiles_nickname_length
  check (nickname is null or char_length(btrim(nickname)) between 1 and 40);
