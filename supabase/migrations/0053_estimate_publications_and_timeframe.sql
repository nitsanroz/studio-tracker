-- 0053 — every published offer gets its own link, and each estimate section
-- carries an estimated timeframe. Nitsan, 2026-10-12.
--
-- (1) estimate_publications. Until now publishing reused the estimate's one
-- `share_token` and OVERWROTE `published_snapshot`, so a client's existing link
-- silently changed to whatever was published next. Now each publish inserts a
-- row here with a NEW token and its own frozen snapshot, and the earlier link
-- keeps showing exactly the offer it was sent with. `lead_estimates.share_token`
-- / `published_snapshot` / `published_at` stay and always mirror the LATEST
-- publication, so everything in the app that reads them is unchanged.
--
-- Admin-only like every lead table (0042/0045). The public /estimate/[token]
-- page reads with the service role, so there is no anon policy.
--
-- Backfill: every estimate already published gets its current link copied in,
-- so links already sent to clients resolve through the new table too. (The
-- page also falls back to lead_estimates.share_token, so this is belt and braces.)
--
-- (2) estimate_phases.timeframe — free text ("2–3 weeks", "Weeks 1–4"), shown
-- beside the section title on the client page. Free text on purpose: the studio
-- writes these as phrases, and a number of weeks cannot say "runs alongside the
-- website".

create table if not exists estimate_publications (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references lead_estimates(id) on delete cascade,
  token text not null unique,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id) on delete set null
);
create index if not exists estimate_publications_estimate_idx on estimate_publications (estimate_id, published_at desc);

alter table estimate_publications enable row level security;
drop policy if exists "admin all" on estimate_publications;
create policy "admin all" on estimate_publications for all using (is_admin()) with check (is_admin());

insert into estimate_publications (estimate_id, token, snapshot, published_at)
select id, share_token, published_snapshot, coalesce(published_at, now())
from lead_estimates
where share_token is not null and published_snapshot is not null
on conflict (token) do nothing;

alter table estimate_phases add column if not exists timeframe text;
comment on column estimate_phases.timeframe is
  'Estimated timeframe for this section, free text ("2–3 weeks"). Shown beside the section title on the client estimate page (0053).';
