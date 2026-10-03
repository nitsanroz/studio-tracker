-- ── 0046: a colour and an icon per lead stage ───────────────────────────────
-- Nitsan, 2026-10-03. Stages are renamed and added in Settings, so their look
-- is data too, editable beside the name. `icon` is a key from STAGE_ICONS in
-- src/lib/leads/look.tsx (a curated lucide set); an unknown key renders the
-- default dot, so a bad value can never break the board.

alter table lead_stages add column if not exists color text;
alter table lead_stages add column if not exists icon text;

-- Seed the built-in stages by their rule key / kind, never by name.
update lead_stages set color = '#ca8a04', icon = 'sparkles'   where rule_key = 'relevant'    and color is null;
update lead_stages set color = '#0891b2', icon = 'compass'    where rule_key = 'discovery'   and color is null;
update lead_stages set color = '#7c3aed', icon = 'pen'        where rule_key = 'offer_prep'  and color is null;
update lead_stages set color = '#0b43ed', icon = 'send'       where rule_key = 'offer_sent'  and color is null;
update lead_stages set color = '#ea580c', icon = 'scale'      where rule_key = 'negotiation' and color is null;
update lead_stages set color = '#0f9d58', icon = 'trophy'     where kind = 'won'             and color is null;
update lead_stages set color = '#6b7280', icon = 'circle-x'   where kind = 'lost'            and color is null;

notify pgrst, 'reload schema';
