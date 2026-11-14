-- Receipts in the billing mail become expenses to approve (v1.14.0, Nitsan
-- 2026-11-05: "it can appear as a suggestion so it can be reviewed and
-- approved to add to the list of expenses").
--
--   finance_mail_receipts — one row per receipt email the scan read: who sent
--     it, the subject, the day, and the amount taken from its text (the text
--     itself is NEVER stored). `status`: new → added (with the expense row it
--     became) or dismissed; `skipped` = read, but not a receipt the studio paid.
--   finance_mail_ignored  — senders (by site, "notion.so") never to suggest again.
--   finance_mail_accounts.receipts_until — how far each mailbox's receipt
--     search has read; the next one starts from here.
--
-- ⚠️ OWNER ONLY, like 0015 (is_finance_owner()).
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.14.0. Safe to re-run.

create table if not exists finance_mail_receipts (
  id               uuid primary key default gen_random_uuid(),
  account_email    text not null,
  gmail_message_id text not null,
  sender           text,
  -- the sender's site, "figma.com" — what "never suggest this sender" keys on
  domain           text not null,
  -- the Expenses vendor it matched, exactly as written there; null = a new one
  vendor           text,
  -- what to call it on a new row
  suggested_vendor text not null,
  subject          text,
  sent_at          timestamptz not null,
  amount           numeric,
  currency         text,
  status           text not null default 'new' check (status in ('new', 'added', 'dismissed', 'skipped')),
  expense_id       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (account_email, gmail_message_id)
);
create index if not exists finance_mail_receipts_status_idx on finance_mail_receipts (status, sent_at);

alter table finance_mail_receipts enable row level security;
do $$ begin
  create policy "finance owner all" on finance_mail_receipts for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

create table if not exists finance_mail_ignored (
  domain     text primary key,
  created_at timestamptz not null default now()
);

alter table finance_mail_ignored enable row level security;
do $$ begin
  create policy "finance owner all" on finance_mail_ignored for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

alter table finance_mail_accounts add column if not exists receipts_until timestamptz;
