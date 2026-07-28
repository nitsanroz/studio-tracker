-- 0018 — a profile is a PERSON, not an account.
--
-- WHY: the studio's 2016–2022 history was worked by ~24 people who left long
-- before the current roster — Edor Nisim (725h), Avishay Cohen (463h), dikla
-- (459h), adi (336h), Miri Kuntsman (294h), yam sasson (114h) and more. Nitsan
-- wants them on the Team page as archived members so their history is browsable
-- like anyone else's.
--
-- Until now that was impossible: `profiles.id` was `references auth.users(id)`,
-- so every profile required a real login. Honouring the request that way would
-- have meant minting ~24 dormant accounts on @studionmore.com with invented
-- addresses — a standing takeover risk (anyone who later creates one of those
-- mailboxes could request a password reset) created purely to hold historical
-- attribution.
--
-- Dropping the constraint is the better model and the safer one: `profiles` becomes
-- the list of PEOPLE, and having an account is a property of a person rather than
-- a precondition for existing. Nothing in the app depended on the constraint
-- itself — RLS compares `auth.uid() = id`, which is unaffected, and a person with
-- no account matches nobody, so they cannot sign in or be impersonated.
--
-- The one behaviour lost is the ON DELETE CASCADE from auth.users: deleting an
-- auth user no longer removes their profile. That is desirable here — the person
-- and their logged history should outlive the account.

alter table profiles drop constraint if exists profiles_id_fkey;

-- Distinguishes "person who works here" from "person we only have history for".
-- The UI hides invite / password-link / email for these, and `/api/admin/invite`
-- must refuse them: there is no auth user to mint a link for.
alter table profiles
  add column if not exists has_account boolean not null default true;

comment on column profiles.has_account is
  'false = a person kept only for historical attribution (pre-Everhour staff). No auth.users row exists, so they can never sign in. Hide account actions for them.';

-- Belt and braces: anyone without an account must also be inactive, so they can
-- never appear in an active-member list, a task picker or the weekly plan.
alter table profiles drop constraint if exists profiles_no_account_is_inactive;
alter table profiles
  add constraint profiles_no_account_is_inactive
  check (has_account or not active);
