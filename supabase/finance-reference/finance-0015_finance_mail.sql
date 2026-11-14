-- &advice reads the studio's billing mail (v1.12.0, Nitsan 2026-11-05: scan
-- nitsan@, office@ and studio@studionmore.com for renewals, cancellations and
-- price changes). Two tables:
--
--   finance_mail_accounts — the mailboxes connected from Settings, each with a
--     Gmail refresh token (gmail.readonly — it can never send, label or
--     delete). The token is AES-256-GCM encrypted by the app with
--     FINANCE_MAIL_TOKEN_KEY, which only the server holds.
--   finance_tool_mail     — what the scan keeps of each billing email: vendor,
--     kind, date, subject, amount. NEVER the body.
--
-- ⚠️ OWNER ONLY, like the advice tables (is_finance_owner(), reference/0010).
-- Finance has no service key, so the owner's own session reads them.
--
-- ⚠️ ITS OWN TABLES, NOT THE TRACKER'S `gmail_accounts`: that one holds one
-- mailbox per team member, and office@ / studio@ are shared mailboxes.
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.12.0. Safe to re-run.

create table if not exists finance_mail_accounts (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  refresh_token_enc text not null,
  status            text not null default 'ok' check (status in ('ok', 'error', 'revoked')),
  last_error        text,
  -- the newest message the scan has read; the next scan starts from here
  scanned_until     timestamptz,
  last_scan_at      timestamptz,
  connected_at      timestamptz not null default now()
);

alter table finance_mail_accounts enable row level security;
do $$ begin
  create policy "finance owner all" on finance_mail_accounts for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

create table if not exists finance_tool_mail (
  id               uuid primary key default gen_random_uuid(),
  account_email    text not null,
  gmail_message_id text not null,
  -- the Expenses vendor it matched, exactly as written there
  vendor           text not null,
  kind             text not null check (kind in ('receipt', 'renewal', 'price', 'plan', 'cancel', 'failed', 'trial')),
  sent_at          timestamptz not null,
  sender           text,
  subject          text,
  -- the first amount in the subject or preview line, if any
  amount           numeric,
  currency         text,
  created_at       timestamptz not null default now(),
  unique (account_email, gmail_message_id)
);
create index if not exists finance_tool_mail_sent_idx on finance_tool_mail (sent_at);

alter table finance_tool_mail enable row level security;
do $$ begin
  create policy "finance owner all" on finance_tool_mail for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;
