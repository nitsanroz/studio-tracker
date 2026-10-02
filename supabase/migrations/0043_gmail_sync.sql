-- ── 0043: Gmail sync (Leads, Phase 2) ───────────────────────────────────────
-- Read-only Gmail for the lead owners: threads attach to leads automatically
-- (by stored thread id → contact email → company domain), each thread knows
-- who owes the next reply, and the messages themselves are kept as headers +
-- plain text so the Emails tab can show them without a trip to Gmail.
--
-- ⚠️⚠️ `gmail_accounts` HAS RLS ON AND NO POLICY AT ALL. It holds each
-- person's Gmail refresh token (encrypted with GMAIL_TOKEN_KEY, but still the
-- key to a mailbox), so not even an admin's browser can read it — only the
-- service role, inside /api/gmail/*. The app learns "who is connected" through
-- the `gmail_connections` view below, which leaves the token columns out.
--
-- ⚠️ ONLY THREADS THAT MATCH A LEAD ARE EVER STORED. The sync reads the
-- mailbox's change feed, but a message whose thread matches no lead is dropped
-- without a row. Attachments are never stored — the PRD's privacy rule.

create table if not exists gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  email text not null,
  refresh_token_enc text not null,
  -- Gmail's change-feed cursor. Every push carries a newer one; we read the
  -- history since this and then move it forward.
  history_id text,
  watch_expires_at timestamptz,
  status text not null default 'ok' check (status in ('ok', 'error', 'revoked')),
  last_error text,
  last_sync_at timestamptz,
  connected_at timestamptz not null default now()
);

alter table gmail_accounts enable row level security;
-- (no policies — see the header)

-- What the browser may know about a connection — never the token or cursor.
-- ⚠️ DELIBERATELY `security_invoker = false`: the view runs with its OWNER's
-- rights, which is the only way past the table's policy-less RLS, and so it
-- must do the gating itself — hence `where is_admin()`, which still reads the
-- CALLER (auth.uid() comes from the request, not from the view's owner).
create or replace view gmail_connections with (security_invoker = false) as
  select profile_id, email, status, last_error, last_sync_at, watch_expires_at, connected_at
  from gmail_accounts
  where is_admin();

-- ── threads: what Phase 1 had, plus what the mailbox says ───────────────────
alter table lead_threads add column if not exists participants text[] not null default '{}';
alter table lead_threads add column if not exists last_message_at timestamptz;
-- 'us' = the last message came from outside, so the studio owes the reply.
alter table lead_threads add column if not exists reply_owed_by text check (reply_owed_by in ('us', 'them'));
alter table lead_threads add column if not exists message_count int not null default 0;
-- The latest message's snippet until Phase 3 writes a real digest.
alter table lead_threads add column if not exists digest text;
-- How it got here: linked by hand, or matched by the sync.
alter table lead_threads add column if not exists matched_by text
  check (matched_by in ('manual', 'thread', 'email', 'domain'));
alter table lead_threads add column if not exists account_id uuid references gmail_accounts(id) on delete set null;

-- One lead per Gmail thread. A partial index, because Phase 1 rows linked by a
-- pasted URL may have no resolvable id.
create unique index if not exists lead_threads_gmail_unique
  on lead_threads(gmail_thread_id) where gmail_thread_id is not null;

-- ── messages ────────────────────────────────────────────────────────────────
-- ⚠️⚠️ DEDUPED ON THE EMAIL'S OWN Message-ID, NOT GMAIL'S ID. Gmail ids are
-- PER MAILBOX: when Nitsan and Michal are both on a thread, the same email has
-- two different message ids and the conversation two different thread ids.
-- The RFC 822 Message-ID header is the one thing both copies share, so it is
-- the unique key — and it is how the sync finds that a thread arriving from the
-- second mailbox is one we already hold.
create table if not exists lead_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lead_threads(id) on delete cascade,
  rfc_message_id text not null unique,
  gmail_message_id text not null,
  from_addr text,
  from_name text,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text,
  sent_at timestamptz,
  from_us boolean not null default false,
  -- Plain text only, capped by the sync. Never HTML, never attachments.
  body_text text,
  snippet text,
  created_at timestamptz not null default now()
);

create index if not exists lead_messages_thread_idx on lead_messages(thread_id, sent_at);

alter table lead_messages enable row level security;
do $$ begin
  create policy "admin all" on lead_messages for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── "don't attach this thread to this lead again" ───────────────────────────
-- ⚠️ UNLINKING MUST STICK. Without this, the next mail on a wrongly matched
-- thread would re-attach it, and "wrong matches are easy to fix" (US10) would
-- mean fixing the same match every day.
create table if not exists lead_thread_ignores (
  lead_id uuid not null references leads(id) on delete cascade,
  gmail_thread_id text not null,
  created_at timestamptz not null default now(),
  primary key (lead_id, gmail_thread_id)
);

alter table lead_thread_ignores enable row level security;
do $$ begin
  create policy "admin all" on lead_thread_ignores for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- When the mailbox was last searched for this lead's history (12 months).
alter table leads add column if not exists gmail_backfilled_at timestamptz;

notify pgrst, 'reload schema';
