-- ── 0045: pricing estimates (Leads, Phase 4 — no AI) ────────────────────────
-- A priced estimate per lead, built from a service library, in the format the
-- studio already sends (the Unibeam scope doc): phases, lines with min–max
-- hours, "choose one" alternatives, optional extras, totals, VAT, a timeline.
-- Versioned (v1, v2, v3 with a "what changed" note), reviewed through the
-- existing offer flow, published to the client as a frozen web page, and turned
-- into sections + budgeted tasks when the lead is won.
--
-- ⚠️ NO AI (Nitsan, 2026-10-03): every number here is typed or picked from the
-- library. The money is always CALCULATED from hours × rate — the Unibeam doc
-- had lines whose ₪ did not match their hours, and that is the error class this
-- removes.

-- ── the library ─────────────────────────────────────────────────────────────
create table if not exists service_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Groups the library and drives the percentage lines: a "+10% of website"
  -- line adds up the lines whose category is 'website'.
  category text not null default 'other'
    check (category in ('strategy', 'brand', 'deck', 'website', 'other')),
  kind text not null default 'hours' check (kind in ('hours', 'percent')),
  min_hours numeric(7, 2),
  max_hours numeric(7, 2),
  percent numeric(5, 2),
  percent_of text check (percent_of in ('strategy', 'brand', 'deck', 'website', 'other')),
  -- The client-facing sentence an estimate line starts with.
  description text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'percent' or (min_hours is not null and max_hours is not null and max_hours >= min_hours)),
  check (kind = 'hours' or (percent is not null and percent_of is not null))
);

-- ── one estimate version ────────────────────────────────────────────────────
-- ⚠️ A VERSION IS A ROW, AND ONCE APPROVED IT IS NEVER EDITED. "Save as new
-- version" copies it (phases and lines too) into version + 1, which is what
-- keeps "what did v2 say" answerable — the same rule as lead_offers.
create table if not exists lead_estimates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  rate numeric(8, 2) not null default 350,
  vat_percent numeric(5, 2) not null default 18,
  discount_percent numeric(5, 2) check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  discount_note text,
  -- Client-facing text around the numbers.
  intro text,
  timeline text,
  closing text,
  -- What changed against the previous version; internal.
  change_note text,
  offer_id uuid references lead_offers(id) on delete set null,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  -- The client link: frozen on Publish, like report_links.snapshot.
  share_token text unique,
  published_snapshot jsonb,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (lead_id, version)
);

create table if not exists estimate_phases (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references lead_estimates(id) on delete cascade,
  name text not null,
  description text,
  position int not null default 0
);

create table if not exists estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references lead_estimates(id) on delete cascade,
  phase_id uuid references estimate_phases(id) on delete cascade,
  service_item_id uuid references service_items(id) on delete set null,
  name text not null,
  description text,
  category text not null default 'other'
    check (category in ('strategy', 'brand', 'deck', 'website', 'other')),
  kind text not null default 'hours' check (kind in ('hours', 'percent')),
  min_hours numeric(7, 2),
  max_hours numeric(7, 2),
  percent numeric(5, 2),
  percent_of text check (percent_of in ('strategy', 'brand', 'deck', 'website', 'other')),
  -- Shown, priced, but not in the total.
  optional boolean not null default false,
  -- Lines sharing a group are "choose one"; only the chosen one is totalled.
  alt_group text,
  chosen boolean not null default true,
  position int not null default 0,
  -- Set when the lead is won and this line became a task (US21's feedback loop).
  task_id uuid references tasks(id) on delete set null
);

create index if not exists lead_estimates_lead_idx on lead_estimates(lead_id, version);
create index if not exists estimate_phases_est_idx on estimate_phases(estimate_id, position);
create index if not exists estimate_lines_est_idx on estimate_lines(estimate_id, position);
create index if not exists estimate_lines_item_idx on estimate_lines(service_item_id);

alter table service_items   enable row level security;
alter table lead_estimates  enable row level security;
alter table estimate_phases enable row level security;
alter table estimate_lines  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['service_items','lead_estimates','estimate_phases','estimate_lines'] loop
    begin
      execute format(
        'create policy "admin all" on %I for all using (is_admin()) with check (is_admin())', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── seed: the library, from the Unibeam scope doc (Sep 2026) ────────────────
insert into service_items (name, category, kind, min_hours, max_hours, percent, percent_of, description, position)
select v.name, v.category, v.kind, v.min_hours, v.max_hours, v.percent, v.percent_of, v.description, v.position
from (values
  ('Strategy workshop', 'strategy', 'hours', 52::numeric, 80::numeric, null::numeric, null::text,
   'We lead the strategy process and tie it directly to the brand concept, with a team of three from kickoff to presentation within one week.', 1),
  ('Alignment session (1–2 days)', 'strategy', 'hours', 16, 32, null, null,
   'You lead the strategy, and we use this session to understand it and align on direction before the visual identity work begins.', 2),
  ('New logo, all formats', 'brand', 'hours', 40, 60, null, null, null, 3),
  ('Logo refinement', 'brand', 'hours', 16, 24, null, null,
   'Refinement of your existing logo to match the new brand.', 4),
  ('Visual identity & visual language', 'brand', 'hours', 100, 160, null, null, null, 5),
  ('Pitch deck (12 slides)', 'deck', 'hours', 32, 44, null, null,
   'A pitch deck in the new brand, including the story structure.', 6),
  ('Homepage — wireframe & design', 'website', 'hours', 100, 140, null, null, null, 7),
  ('Inner page — wireframe & design', 'website', 'hours', 24, 40, null, null, null, 8),
  ('Mobile', 'website', 'percent', null, null, 10, 'website', 'Mobile versions of every page.', 9),
  ('Prep for development', 'website', 'percent', null, null, 10, 'website', null, 10),
  ('QA', 'website', 'percent', null, null, 10, 'website', null, 11)
) as v(name, category, kind, min_hours, max_hours, percent, percent_of, description, position)
where not exists (select 1 from service_items);

-- Studio-wide pricing defaults, read when a new estimate is created.
insert into lead_settings (key, value)
select 'pricing', '{"rate": 350, "vat_percent": 18}'::jsonb
where not exists (select 1 from lead_settings where key = 'pricing');

notify pgrst, 'reload schema';
