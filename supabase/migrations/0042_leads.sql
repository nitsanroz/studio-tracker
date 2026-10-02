-- ── 0042: leads ─────────────────────────────────────────────────────────────
-- The sales pipeline — Phase 1 of Michal's PRD as Nitsan reviewed it on
-- 2026-10-02: a lead record, editable stages, a board, contacts, a versioned
-- offers log, hand-linked Gmail threads, an activity log, and "Mark as won"
-- turning a lead into a client. Gmail sync, AI and estimates are later phases
-- and add to these tables rather than replacing them.
--
-- ⚠️⚠️ ADMIN-ONLY, EVERY LEAD TABLE — the same shape as candidates (0039), and
-- for the same reason: outside people's names, mailboxes and phone numbers,
-- plus what the studio is about to charge them. `is_admin()` IS the rule: the
-- admins are Nitsan, Michal and the shared "Office" account, and Nitsan
-- confirmed (2026-10-02) that all three should see the pipeline. If an admin is
-- ever added who should not, this is the file that has to change.
--
-- ⚠️ `client_contacts` IS THE EXCEPTION, AND DELIBERATELY. It belongs to a
-- client, not to a lead — the people the team will actually work with once the
-- deal is won — so it follows `clients` (0001): read by any signed-in member,
-- written by admins.
--
-- ⚠️ TEXT + CHECK RATHER THAN ENUMS, as 0039 explains.

-- ── the board's columns ─────────────────────────────────────────────────────
-- Free-form like candidate_stages, with two additions:
--   `kind`        — which columns mean "still open", "won" and "lost". The app
--                   keys Won/Lost behaviour off this, NEVER off the name, so
--                   renaming "Won" to "Signed" changes nothing but the label.
--   `stall_days`  — business days (Sun–Thu) of silence before a lead in this
--                   stage is flagged Stalled. Null = never stalls here.
create table if not exists lead_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  stall_days int check (stall_days is null or stall_days > 0),
  created_at timestamptz not null default now()
);

create table if not exists lead_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ── the company and the deal ────────────────────────────────────────────────
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  website text,
  -- Lower-cased, no www. Phase 2 matches Gmail threads on it, so it is stored
  -- rather than derived from `website` on every read.
  domain text,
  source text check (source in ('cold', 'linkedin', 'website', 'referral', 'past_client')),
  stage_id uuid references lead_stages(id) on delete set null,
  owner_id uuid references profiles(id) on delete set null,

  est_value numeric(12, 2) check (est_value is null or est_value >= 0),
  currency text not null default 'ILS' check (currency in ('ILS', 'USD')),
  asked_for text,

  -- Every open lead should have one; the app flags those that don't. Not NOT
  -- NULL, because an imported row or a fresh web-form lead arrives without.
  next_step text,
  next_step_due date,

  lost_reason_id uuid references lead_lost_reasons(id) on delete set null,
  lost_note text,

  -- Where it came from in Michal's Sheets, for the one-time import (re-runnable:
  -- the import matches on it and never makes a second lead for one row).
  sheet_ref text unique,

  -- Set by "Mark as won".
  client_id uuid references clients(id) on delete set null,
  section_id uuid references sections(id) on delete set null,
  won_at timestamptz,

  stage_changed_at timestamptz not null default now(),
  -- The stalled clock. Written by every real change and every logged activity.
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists leads_stage_idx on leads(stage_id);
create index if not exists leads_domain_idx on leads(domain);
create index if not exists leads_client_idx on leads(client_id);
create index if not exists leads_activity_idx on leads(last_activity_at desc);

create table if not exists lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  linkedin text,
  -- Carried over from the Sheet's columns of the same names.
  persona text,
  past_connection text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists lead_contacts_lead_idx on lead_contacts(lead_id, position);
-- Phase 2 matches threads on a contact's address first.
create index if not exists lead_contacts_email_idx on lead_contacts(lower(email));

-- ── what the client received ────────────────────────────────────────────────
-- ⚠️ ONE ROW PER VERSION, NEVER EDITED INTO THE NEXT ONE. "What exactly did we
-- send them in March" is the question this table exists to answer, so v2 is a
-- new row beside v1, not v1 overwritten.
create table if not exists lead_offers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  version int not null default 1,
  amount numeric(12, 2) check (amount is null or amount >= 0),
  currency text not null default 'ILS' check (currency in ('ILS', 'USD')),
  scope_summary text,
  storage_path text,
  file_name text,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'sent', 'accepted', 'declined')),
  sent_at date,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists lead_offers_lead_idx on lead_offers(lead_id, version);

-- ── Gmail threads, linked by hand for now ───────────────────────────────────
-- Phase 2 adds participants / last_message_at / digest / reply_owed_by here
-- and fills them from the Gmail API; until then a row is a pasted link.
create table if not exists lead_threads (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  gmail_thread_id text,
  url text not null,
  subject text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists lead_threads_lead_idx on lead_threads(lead_id);
create index if not exists lead_threads_gmail_idx on lead_threads(gmail_thread_id);

-- ── what happened, and when ─────────────────────────────────────────────────
-- Calls, meetings and notes somebody LOGGED, plus the changes the app records
-- on its own (stage moves, offers, won/lost) — one timeline, because "how did
-- this deal move" is read top to bottom as one story.
create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  kind text not null
    check (kind in ('created', 'call', 'meeting', 'note', 'stage_change', 'offer', 'won', 'lost', 'reopened', 'email')),
  body text,
  meta jsonb,
  actor_id uuid references profiles(id) on delete set null,
  -- When it HAPPENED, which a logged call can backdate; created_at is when it
  -- was typed.
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on lead_events(lead_id, at desc);

-- ── the people at a client ──────────────────────────────────────────────────
create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  linkedin text,
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists client_contacts_client_idx on client_contacts(client_id, position);

-- ── settings that are nobody else's business ────────────────────────────────
-- ⚠️ NOT `app_settings`, which every signed-in member can read (0003). This
-- holds the website form's webhook secret — anyone holding it can drop leads
-- onto the board — and the cached exchange rate.
create table if not exists lead_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table lead_settings     enable row level security;
alter table lead_stages       enable row level security;
alter table lead_lost_reasons enable row level security;
alter table leads             enable row level security;
alter table lead_contacts     enable row level security;
alter table lead_offers       enable row level security;
alter table lead_threads      enable row level security;
alter table lead_events       enable row level security;
alter table client_contacts   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'lead_settings','lead_stages','lead_lost_reasons','leads','lead_contacts',
    'lead_offers','lead_threads','lead_events','client_contacts'
  ] loop
    begin
      execute format(
        'create policy "admin all" on %I for all using (is_admin()) with check (is_admin())', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- The one table here the team reads — see the header.
do $$ begin
  create policy "read all" on client_contacts for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- ── seed ────────────────────────────────────────────────────────────────────
-- Michal's seven stages and her stall limits (business days).
insert into lead_stages (name, position, kind, stall_days)
select v.name, v.position, v.kind, v.stall_days from (values
  ('Relevant',      1, 'open', 10),
  ('Discovery',     2, 'open', 10),
  ('Offer in prep', 3, 'open', null::int),
  ('Offer sent',    4, 'open', 5),
  ('Negotiation',   5, 'open', 7),
  ('Won',           6, 'won',  null::int),
  ('Lost',          7, 'lost', null::int)
) as v(name, position, kind, stall_days)
where not exists (select 1 from lead_stages);

insert into lead_lost_reasons (name, position)
select v.name, v.position from (values
  ('Budget',                   1),
  ('Timing',                   2),
  ('Went with another studio', 3),
  ('No response',              4),
  ('Not a fit',                5)
) as v(name, position)
where not exists (select 1 from lead_lost_reasons);

-- The website form's secret. The Framer webhook URL is
-- /api/leads/inbound/<this>, shown to admins in Settings → Leads. Two uuids
-- with the dashes taken out: 64 hex characters from the built-in generator,
-- so this needs no extension.
insert into lead_settings (key, value)
select 'inbound_token',
       to_jsonb(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
where not exists (select 1 from lead_settings where key = 'inbound_token');

notify pgrst, 'reload schema';
