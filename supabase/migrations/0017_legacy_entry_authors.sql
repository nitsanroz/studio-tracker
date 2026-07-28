-- 0017 — let a recovered pre-Everhour entry name an author who has no account.
--
-- WHY: the pre-Everhour Asana comments that hold the studio's 2016–2022 hours were
-- written overwhelmingly by people who left long before the current roster — yam
-- sasson (377 comments), Edor Nisim (251), Miri Kuntsman (226), adi (211), ruth,
-- dikla, "office &more" and ~20 more. Only 6 comment authors match a profile
-- today: 222 of 2,397 comments, 1,077h of 7,934h.
--
-- Nitsan's decision was to keep every hour's real author and date. The obvious
-- route — one inactive profile per person — is NOT available: `profiles.id` is a
-- foreign key to `auth.users(id)`, so a profile requires a real login account.
-- Honouring it that way would mean minting ~27 dormant accounts on
-- @studionmore.com with invented addresses for people who left years ago, which
-- is a standing security liability created as a side effect of a data import.
--
-- Instead an entry may carry a plain author NAME with no profile. That keeps what
-- was actually wanted (real per-person, per-date history) and costs nothing: these
-- rows are all `legacy = true`, and every personal surface already filters those
-- out via the store's `entrySums`, so a null user_id can never reach the
-- days-worked counter, "my hours", the timesheet or per-member totals.

alter table time_entries alter column user_id drop not null;

alter table time_entries
  add column if not exists legacy_author_name text;

comment on column time_entries.legacy_author_name is
  'Raw Asana comment author for a recovered pre-Everhour entry whose author has no profile (they left before the current roster). Display-only.';

-- An entry must always say who did the work, one way or the other. Only the
-- recovered rows may use the name-without-profile form; anything the app writes
-- today still requires a real user_id.
alter table time_entries drop constraint if exists time_entries_author_present;
alter table time_entries
  add constraint time_entries_author_present
  check (user_id is not null or (legacy and legacy_author_name is not null));

-- Members may only touch their OWN entries, and the existing policies compare
-- auth.uid() = user_id. A null user_id therefore matches nobody, which is the
-- intended outcome: nobody can edit or delete the historical backfill through the
-- app. Admins keep full access via the `admin all` policy.
