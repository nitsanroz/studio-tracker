-- ── Shareable, LIVE client Gantt links ────────────────────────────────────
--
-- Mirrors report_links, with one deliberate difference: there is no snapshot
-- column. A client report is a published, frozen statement of hours (clients
-- must never see live numbers). A shared Gantt is the opposite — it is a plan,
-- and a plan the client is reading is only useful if it is the current one.
--
-- Its own table rather than a second path on report_links, so that sharing the
-- schedule does NOT hand out the hours: the two tokens are independent and
-- either can be revoked (`active = false`) without touching the other.
create table if not exists gantt_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gantt_links_client_idx on gantt_links(client_id);

alter table gantt_links enable row level security;
do $$ begin
  create policy "admin all" on gantt_links for all using (is_admin());
exception when duplicate_object then null; end $$;
-- deliberately no anon policy: the public /gantt/[token] page reads via the
-- service role and returns only names, dates and type colours — never hours,
-- status or assignees.
