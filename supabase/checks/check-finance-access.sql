-- Who can reach what — a READ-ONLY check of the three access tiers (2026-11-14).
--
-- Run the whole file in the Supabase SQL editor. It changes nothing: it counts
-- rows as two stand-ins — an admin who is not the owner (Michal's tier) and an
-- ordinary member — and tries the finance flag inside a block that always
-- rolls itself back. Read the result table:
--
--   ok = true  on every row  → the tiers hold.
--   ok = false               → that tier can see (or change) something it must not.
--
-- `visible` is what the stand-in sees, `total` what is really there (0 of 0
-- proves nothing — the table is empty). Counts only; no amount or name is read
-- out. Not a migration, so not numbered like one; and not under data/, which
-- git ignores.

create temp table if not exists _finance_access_check (
  who text, what text, visible bigint, total bigint, ok boolean
);
truncate _finance_access_check;

do $$
declare
  admin_id  uuid;
  member_id uuid;
  who_id    uuid;
  who_name  text;
  t         text;
  seen      bigint;
  total     bigint;
  outcome   text;
  -- Full-finance only: nobody below that tier may see a row.
  full_only text[] := array[
    'finance_pnl_monthly', 'finance_client_monthly', 'client_rates', 'finance_events',
    'finance_salaries', 'finance_freelance', 'finance_income', 'finance_undo_log',
    'finance_payslips', 'finance_person_factors', 'finance_not_hourly', 'finance_tracker_ignored',
    'finance_advice_items', 'finance_advice_runs', 'finance_mail_accounts', 'finance_tool_mail',
    'finance_scenarios', 'finance_scenario_settings', 'finance_scenario_advice',
    'advice_items', 'advice_runs'
  ];
  -- Admins may (the Expenses page, HR, billing, freelancers); members may not.
  admin_only text[] := array[
    'finance_expenses', 'finance_locks', 'fx_rates', 'finance_mail_receipts', 'finance_mail_ignored',
    'finance_documents', 'member_hr', 'member_notes', 'client_billing_periods',
    'freelancers', 'freelancer_logs', 'freelancer_charges'
  ];
begin
  select id into admin_id from profiles
    where role = 'admin' and coalesce(position, '') <> 'owner' and active
    order by created_at limit 1;
  select id into member_id from profiles
    where role <> 'admin' and active and coalesce(has_account, true)
    order by created_at limit 1;

  foreach who_name in array array['admin, not owner', 'member'] loop
    who_id := case who_name when 'member' then member_id else admin_id end;
    if who_id is null then
      insert into _finance_access_check values (who_name, '(nobody in this tier to test with)', null, null, null);
      continue;
    end if;

    foreach t in array (case who_name when 'member' then full_only || admin_only else full_only end) loop
      begin
        execute format('select count(*) from %I', t) into total;
        perform set_config('request.jwt.claims', json_build_object('sub', who_id, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', who_id::text, true);
        execute 'set local role authenticated';
        execute format('select count(*) from %I', t) into seen;
        execute 'reset role';
        insert into _finance_access_check values (who_name, t, seen, total, seen = 0);
      exception
        when undefined_table then
          execute 'reset role';
          insert into _finance_access_check values (who_name, t || ' (no such table)', null, null, true);
        when insufficient_privilege then
          execute 'reset role';
          insert into _finance_access_check values (who_name, t, 0, total, true);
      end;
    end loop;

    -- Can they give themselves finance access? Always rolled back: the inner
    -- block ends in an exception either way.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', who_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', who_id::text, true);
      execute 'set local role authenticated';
      update profiles set finance_full_access = not coalesce(finance_full_access, false) where id = who_id;
      raise exception 'not_blocked';
    exception
      when insufficient_privilege then outcome := 'blocked';
      when others then outcome := case sqlerrm when 'not_blocked' then 'NOT BLOCKED' else sqlerrm end;
    end;
    execute 'reset role';
    insert into _finance_access_check
      values (who_name, 'set own finance_full_access: ' || outcome, null, null, outcome = 'blocked');
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

select * from _finance_access_check order by ok nulls first, who, what;
