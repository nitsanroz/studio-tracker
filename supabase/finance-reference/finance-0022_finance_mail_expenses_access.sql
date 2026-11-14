-- "From your mail" for everyone who works on Expenses (v1.18.0, Nitsan
-- 2026-11-08: "make sure Michal sees the expenses orange suggestions").
--
-- Until now the receipts list, its files and the "never suggest" list were the
-- owner's alone (0016, 0019). This lets every Expenses user — full finance AND
-- expenses-only admins like Michal, i.e. tracker role admin, `is_admin()` —
-- see the waiting receipts, add or dismiss them, and open their files.
--
-- What stays the owner's alone:
--   finance_mail_accounts (the mailbox tokens) and finance_tool_mail. Only the
--   owner's session reads the mail; Michal sees what it found. When it last
--   read comes from finance_mail_last_scan() below — times only, no tokens.
--   finance_freelance stays full-finance; finance_freelance_names() hands
--   back the names alone, so freelancers' invoices stay off her list too.
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.18.0. Safe to re-run.

-- The waiting receipts: read, and decide (add / dismiss). The scan, run by the
-- owner, is still the only thing that inserts them.
do $$ begin
  create policy "expenses users read" on finance_mail_receipts for select using (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "expenses users decide" on finance_mail_receipts for update using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- "Never suggest this site" (an upsert: insert + update).
do $$ begin
  create policy "expenses users all" on finance_mail_ignored for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- Documents on expenses and on waiting receipts.
do $$ begin
  create policy "expenses users all" on finance_documents for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance docs expenses read" on storage.objects for select
    using (bucket_id = 'finance-docs' and is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance docs expenses add" on storage.objects for insert
    with check (bucket_id = 'finance-docs' and is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance docs expenses remove" on storage.objects for delete
    using (bucket_id = 'finance-docs' and is_admin());
exception when duplicate_object then null; end $$;

-- When each mailbox was last read — for the list's "Read 2 h ago" line.
create or replace function finance_mail_last_scan()
returns table (email text, status text, last_scan_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.email, a.status, a.last_scan_at from finance_mail_accounts a where is_admin();
$$;
revoke all on function finance_mail_last_scan() from public, anon;
grant execute on function finance_mail_last_scan() to authenticated;

-- Freelancers' names (no amounts), so their invoices go to the Freelance page, not the list.
create or replace function finance_freelance_names(since_year int)
returns setof text
language sql stable security definer set search_path = public as $$
  select distinct trim(person_name) from finance_freelance
  where is_admin() and year >= since_year and coalesce(trim(person_name), '') <> '';
$$;
revoke all on function finance_freelance_names(int) from public, anon;
grant execute on function finance_freelance_names(int) to authenticated;
