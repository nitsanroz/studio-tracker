-- ── 0039: candidate tracking ────────────────────────────────────────────────
-- Hiring, replacing the Asana board "Candidate Tracking" (271 cards, Jun 2020
-- → today). Nine tables, all ADMIN-ONLY.
--
-- ⚠️⚠️ THERE IS NO "read all" POLICY ANYWHERE IN THIS FILE, AND THAT IS THE ONE
-- THING NOT TO COPY FROM tasks/clients/tags. Studio-wide read visibility is
-- intentional for the studio's own work (see the Access control section of
-- CLAUDE.md) and is exactly wrong here: these rows hold outside people's phone
-- numbers, home email addresses, CVs and two colleagues' written opinions of
-- them. They follow `member_hr` and `member_notes` instead — `admin all`, and
-- nothing else. Michal is an admin, which is what gives her access.
--
-- ⚠️ ARCHIVED AND ON HOLD ARE A STATUS, NOT STAGES, and that is the single
-- biggest departure from the Asana board. There, "To Reject" is a column — and
-- it holds 140 of the 271 cards, so the widest column on the board is the one
-- nobody wants to look at. Here a rejected candidate leaves the board entirely
-- and stays searchable. "On Hold" (18 cards) is the same shape: a place someone
-- parks, not a step they pass through.
--
-- ⚠️ TEXT + CHECK RATHER THAN A POSTGRES ENUM, deliberately. `absence_type` is
-- an enum and it cost a real outage: the weekly-plan sheet carried values the
-- enum did not know, the insert threw, and because the sync deletes before it
-- inserts it wiped the days it was meant to fill (v1.19.1). A CHECK still needs
-- a migration to widen, but it fails loudly on one row instead of aborting a
-- statement, and it can be widened without an ALTER TYPE.

-- ── the board's columns ─────────────────────────────────────────────────────
-- Free-form, per Nitsan: add, rename and reorder without a deploy. Seeded below
-- from the five columns the real board actually moves people through.
create table if not exists candidate_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ── the role a candidate applied for ────────────────────────────────────────
-- One pool with a role TAG, not a board per opening: a good CV from two years
-- ago has to stay findable when a similar role opens. A table rather than a
-- text column so "Junior Designer" and "junior designer" cannot both exist, and
-- so renaming a role is one edit — same reasoning as `task_types` (0024).
create table if not exists candidate_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6b7280',
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ── the person ──────────────────────────────────────────────────────────────
create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  role_id uuid references candidate_roles(id) on delete set null,
  stage_id uuid references candidate_stages(id) on delete set null,
  -- Who is holding this one. Null is legitimate and common: on the real board
  -- 151 of 271 cards were never assigned to anybody.
  owner_id uuid references profiles(id) on delete set null,

  -- 'active'   — on the board
  -- 'on_hold'  — good, wrong moment; off the board, not rejected
  -- 'archived' — decided; see `outcome`
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'archived')),
  -- Only meaningful once archived, and NOT NULL-constrained against status on
  -- purpose: an import can archive a row whose reason nobody recorded, and a
  -- constraint that refuses that would refuse the history.
  outcome text check (outcome in ('hired', 'rejected', 'withdrawn')),
  archived_at timestamptz,
  archived_by uuid references profiles(id) on delete set null,

  -- Where they came from. Free text rather than a CHECK: today it is jobs@ and
  -- LinkedIn, tomorrow it is a referral or a recruiter, and none of that is
  -- worth a migration.
  source text,
  -- The body of what they sent, verbatim. Never rewritten by the studio — the
  -- notes we write about them live on the interviews and in the discussion.
  application_text text,
  applied_on date,

  -- Sorted on by the list view, so it is stored rather than derived from a
  -- max() over three child tables. The app writes it on every real change.
  last_activity_at timestamptz not null default now(),

  -- ⚠️ IMPORT IDEMPOTENCY. The Asana pull is re-runnable and MUST NOT create a
  -- second card for a candidate it has already brought across; this is the key
  -- it matches on, the same convention as `everhour_id` and `asana_story_gid`.
  asana_gid text unique,

  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists candidates_stage_idx on candidates(stage_id);
create index if not exists candidates_status_idx on candidates(status);
create index if not exists candidates_role_idx on candidates(role_id);
-- The list view's default sort, and the only query that runs on every page load.
create index if not exists candidates_activity_idx on candidates(status, last_activity_at desc);

-- ── CVs, portfolios, anything with a URL ────────────────────────────────────
-- ⚠️ ONE TABLE FOR BOTH AN UPLOADED FILE AND A TYPED LINK, which is the shape
-- the intake form already proved: a client's upload becomes a `links` row
-- holding a storage URL, and nothing downstream needs to care which it was.
-- `kind` exists only so the CV can be shown apart from three portfolio links.
create table if not exists candidate_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  title text not null,
  url text not null,
  kind text not null default 'other' check (kind in ('cv', 'portfolio', 'other')),
  -- Set when we hold the bytes ourselves, so a sweep can tell an uploaded file
  -- from a link to somebody else's site.
  storage_path text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists candidate_links_candidate_idx on candidate_links(candidate_id, position);

-- ── scoring vocabulary ──────────────────────────────────────────────────────
-- Two levels because Nitsan asked for a COLUMN PER SUBJECT holding 3–8
-- parameters: subjects are the columns, parameters are the rows inside one.
create table if not exists candidate_score_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  -- ⚠️ RETIRED, NEVER DELETED. Dropping a subject would cascade away the scores
  -- recorded under it, i.e. rewrite what somebody actually thought of a
  -- candidate in 2024. Settings offers "remove", which sets this false: new
  -- scorecards stop offering it, existing ones still render their numbers.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists candidate_score_params (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references candidate_score_subjects(id) on delete cascade,
  name text not null,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists candidate_score_params_subject_idx
  on candidate_score_params(subject_id, position);

-- ── one interview ───────────────────────────────────────────────────────────
-- ⚠️ ONE ROW PER INTERVIEW, NOT ONE SCORECARD PER CANDIDATE. Michal's phone
-- screen and Nitsan's own interview are separate records with separate scores,
-- so the two readings sit side by side and a disagreement between them survives
-- — which is the thing worth knowing when two people meet the same person. A
-- single shared scorecard would let whoever typed last overwrite the other.
create table if not exists candidate_interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  -- Free text ("Phone interview", "Physical interview", "Tryout day"). It is
  -- NOT a foreign key to candidate_stages: renaming a board column must not
  -- rewrite the label on an interview that happened two years ago.
  kind text not null default 'Interview',
  held_on date,
  held_at_time text,
  interviewer_id uuid references profiles(id) on delete set null,
  summary text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists candidate_interviews_candidate_idx
  on candidate_interviews(candidate_id, held_on);

-- ── one number ──────────────────────────────────────────────────────────────
create table if not exists candidate_scores (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references candidate_interviews(id) on delete cascade,
  param_id uuid not null references candidate_score_params(id) on delete cascade,
  value int not null check (value between 1 and 10),
  -- One value per parameter per interview. Without this a double-submit leaves
  -- two numbers for one question and every average is quietly wrong.
  unique (interview_id, param_id)
);

create index if not exists candidate_scores_interview_idx on candidate_scores(interview_id);

-- ── the discussion ──────────────────────────────────────────────────────────
-- ⚠️ `author_name` mirrors `task_comments` (0016) and is there for the import:
-- every comment on the Asana board was posted by either Nitsan or the SHARED
-- `office &more` account, so historical authorship is coarse and `author_id`
-- cannot always be resolved to a person. A comment written in this app always
-- has an author_id.
create table if not exists candidate_comments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  body text not null,
  asana_story_gid text unique,
  created_at timestamptz not null default now()
);

create index if not exists candidate_comments_candidate_idx
  on candidate_comments(candidate_id, created_at);

-- ── what happened, and when ─────────────────────────────────────────────────
-- Append-only. Answers "who moved this, and when" on the candidate page.
create table if not exists candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  kind text not null,
  detail text,
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists candidate_events_candidate_idx
  on candidate_events(candidate_id, created_at desc);

-- ── RLS: admin only, every table ────────────────────────────────────────────
alter table candidate_stages          enable row level security;
alter table candidate_roles           enable row level security;
alter table candidates                enable row level security;
alter table candidate_links           enable row level security;
alter table candidate_score_subjects  enable row level security;
alter table candidate_score_params    enable row level security;
alter table candidate_interviews      enable row level security;
alter table candidate_scores          enable row level security;
alter table candidate_comments        enable row level security;
alter table candidate_events          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'candidate_stages','candidate_roles','candidates','candidate_links',
    'candidate_score_subjects','candidate_score_params','candidate_interviews',
    'candidate_scores','candidate_comments','candidate_events'
  ] loop
    begin
      execute format(
        'create policy "admin all" on %I for all using (is_admin()) with check (is_admin())', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── seed: the stages the real board moves people through ────────────────────
-- ⚠️ "To Reject" and "On Hold" are NOT here — they are `status` values. Their
-- 158 cards are exactly why (see the header).
-- `where not exists` keeps every seed below re-runnable.
insert into candidate_stages (name, position)
select v.name, v.position from (values
  ('Candidates',            1),
  ('Phone interview',       2),
  ('Physical interview',    3),
  ('התנסות בסטודיו',        4),
  ('Contract',              5)
) as v(name, position)
where not exists (select 1 from candidate_stages);

insert into candidate_roles (name, color, position)
select v.name, v.color, v.position from (values
  ('Junior Designer', '#0b43ed', 1),
  ('Senior Designer', '#7c3aed', 2),
  ('Motion Designer', '#0891b2', 3),
  ('Developer',       '#15803d', 4),
  ('Other',           '#6b7280', 5)
) as v(name, color, position)
where not exists (select 1 from candidate_roles);

-- ── seed: a starting scoring vocabulary ─────────────────────────────────────
-- Nitsan's three subjects, with parameters he can rename, reorder, retire or
-- add to in Settings. Deliberately 3–4 each rather than the full 8 the layout
-- supports: an empty row is easy to add and a wrong one nobody removes gets
-- scored 5 out of politeness for ever.
insert into candidate_score_subjects (name, position)
select v.name, v.position from (values
  ('Personality',     1),
  ('Professionalism', 2),
  ('Experience',      3)
) as v(name, position)
where not exists (select 1 from candidate_score_subjects);

insert into candidate_score_params (subject_id, name, position)
select s.id, v.name, v.position
from (values
  ('Personality',     'Communication',          1),
  ('Personality',     'Energy',                 2),
  ('Personality',     'Fit with the studio',    3),
  ('Personality',     'Takes feedback',         4),
  ('Professionalism', 'Craft in the portfolio', 1),
  ('Professionalism', 'Typography',             2),
  ('Professionalism', 'Process & reasoning',    3),
  ('Professionalism', 'Attention to detail',    4),
  ('Experience',      'Years in the field',     1),
  ('Experience',      'Range of work',          2),
  ('Experience',      'Tools & software',       3)
) as v(subject, name, position)
join candidate_score_subjects s on s.name = v.subject
where not exists (select 1 from candidate_score_params);
