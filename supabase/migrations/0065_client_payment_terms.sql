-- How many days a client has to pay an invoice (Nitsan, 2026-11-10).
--
-- WHY: "14 days" was a constant in three places — the tracker's &advice, the
-- finance app's &advice and finance's receivables list — so a client on longer
-- terms (Maccabi pays net+30) was reported late for two weeks every month, and
-- nothing could say otherwise. One number per client, in the table both apps
-- read, so the two can't disagree.
--
-- Counted from the invoice: the day after a billing period ends (the client's
-- invoice day — Client Reports aligns periods on it), or, in finance, the date
-- the invoice actually went out when the Plan has one.
--
-- Days only, never money — Michal sees Client Reports, where it is edited, so
-- that is deliberate. Clients RLS is unchanged: everyone reads, admins write.
--
-- Safe to re-run. The app reads a missing column as 14 days, so it can deploy
-- before or after this runs.

alter table clients
  add column if not exists payment_terms_days int not null default 14;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_payment_terms_days_range') then
    alter table clients
      add constraint clients_payment_terms_days_range
      check (payment_terms_days between 0 and 180);
  end if;
end $$;

-- The one client not on the studio's 14 days today. Matched by name ONCE, here;
-- from now on it is edited in Client Reports.
update clients set payment_terms_days = 30
 where name = 'Maccabi' and payment_terms_days = 14;
