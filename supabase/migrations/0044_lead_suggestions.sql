-- ── 0044: rule-based stage suggestions, offer alerts (Leads, Phase 3 lite) ──
-- Nitsan, 2026-10-02: Phase 3 WITHOUT AI — no extra running cost. The app
-- suggests stage moves from a few plain rules (an offer went out, the client
-- answered it, a meeting got booked…) and the owner accepts or dismisses each
-- one. Nothing changes stage without a click, the same rule the AI version
-- would have had.

-- ⚠️ RULES FIND STAGES BY `rule_key`, NEVER BY NAME. Stages are renamed freely
-- in Settings; "Offer sent" renamed to "Quote out" must keep its rules. Keys
-- are seeded from the original names once, here, and are not shown in the UI.
alter table lead_stages add column if not exists rule_key text;
do $$ begin
  alter table lead_stages add constraint lead_stages_rule_key_check
    check (rule_key in ('relevant', 'discovery', 'offer_prep', 'offer_sent', 'negotiation'));
exception when duplicate_object then null; end $$;
create unique index if not exists lead_stages_rule_key_unique on lead_stages(rule_key) where rule_key is not null;

update lead_stages set rule_key = 'relevant'    where name = 'Relevant'      and rule_key is null and not exists (select 1 from lead_stages where rule_key = 'relevant');
update lead_stages set rule_key = 'discovery'   where name = 'Discovery'     and rule_key is null and not exists (select 1 from lead_stages where rule_key = 'discovery');
update lead_stages set rule_key = 'offer_prep'  where name = 'Offer in prep' and rule_key is null and not exists (select 1 from lead_stages where rule_key = 'offer_prep');
update lead_stages set rule_key = 'offer_sent'  where name = 'Offer sent'    and rule_key is null and not exists (select 1 from lead_stages where rule_key = 'offer_sent');
update lead_stages set rule_key = 'negotiation' where name = 'Negotiation'   and rule_key is null and not exists (select 1 from lead_stages where rule_key = 'negotiation');

-- ── the suggestions ─────────────────────────────────────────────────────────
create table if not exists lead_suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  -- Which rule fired: 'offer_sent', 'client_replied', 'meeting_booked',
  -- 'offer_accepted', 'offer_declined'.
  rule text not null,
  to_stage_id uuid not null references lead_stages(id) on delete cascade,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'dismissed', 'superseded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null
);

-- ⚠️ ONE PENDING SUGGESTION PER LEAD AND TARGET. Every new client email on an
-- "Offer sent" lead would otherwise stack another identical "→ Negotiation"
-- card; the insert is `on conflict do nothing` against this.
create unique index if not exists lead_suggestions_one_pending
  on lead_suggestions(lead_id, to_stage_id) where status = 'pending';
create index if not exists lead_suggestions_lead_idx on lead_suggestions(lead_id, status);

alter table lead_suggestions enable row level security;
do $$ begin
  create policy "admin all" on lead_suggestions for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── "an offer is waiting for your review" — sent once per offer ─────────────
alter table lead_offers add column if not exists review_alerted_at timestamptz;

notify pgrst, 'reload schema';
