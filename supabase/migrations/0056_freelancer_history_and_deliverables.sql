-- 0056 — a freelancer's page shows his billing history, and he can leave links
-- to his deliverables. Nitsan, 2026-10-13.
--
-- (1) `freelancer_logs.source` — where a log came from:
--   'link'  — he logged it through his private link (everything from now on);
--   'sheet' — imported from the Google Sheet he billed from before the link
--             (AB: Aug 2025 → Oct 2026). These are his BILLING record, shown on
--             his page and counted in his monthly bill — they are not tracker
--             hours: no time_entries row stands behind them (much of that time
--             was never entered in the tracker, or was lumped under someone
--             else's name), so nothing here changes any client's hours.
--   A sheet row may be a monthly lump over 24h (AB's "CodeFlash — Website
--   assets", 84h, Oct 2025), so the 24h bound applies to the logs he enters.
--
-- (2) `freelancer_deliverables` — links he adds on his page (a delivery, a
-- shared folder). Admin-only RLS like the rest; his page reads and writes them
-- through /api/log/[token] with the service key.

alter table freelancer_logs add column if not exists source text not null default 'link';
alter table freelancer_logs drop constraint if exists freelancer_logs_source_check;
alter table freelancer_logs add constraint freelancer_logs_source_check check (source in ('link', 'sheet'));

alter table freelancer_logs drop constraint if exists freelancer_logs_minutes_check;
alter table freelancer_logs add constraint freelancer_logs_minutes_check
  check (minutes > 0 and (minutes <= 1440 or source = 'sheet'));

create table if not exists freelancer_deliverables (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references freelancers(profile_id) on delete cascade,
  title text not null check (length(trim(title)) > 0 and length(title) <= 120),
  url text not null check (url ~* '^https?://' and length(url) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists freelancer_deliverables_profile_idx on freelancer_deliverables (profile_id, created_at desc);

alter table freelancer_deliverables enable row level security;
drop policy if exists "admin all" on freelancer_deliverables;
create policy "admin all" on freelancer_deliverables for all using (is_admin()) with check (is_admin());
