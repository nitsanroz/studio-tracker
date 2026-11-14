-- Documents on expenses (v1.16.0, Nitsan 2026-11-06: "can we have new scanned
-- documents and receipts appear in the system, so I can preview and download
-- them"):
--
--   storage bucket `finance-docs` — PRIVATE. Receipt PDFs/images saved from the
--     billing mail, and files uploaded to an expense. Opened only through
--     short-lived signed links the app makes for the owner.
--   finance_documents — one row per file: which expense it belongs to (or which
--     mail receipt, before it's added), its path in the bucket, name, type, size.
--   finance_mail_receipts.docs_checked_at — when the receipt's attachments were
--     looked for, so each email is fetched once.
--
-- ⚠️ OWNER ONLY, like the mail tables (is_finance_owner(), reference/0010):
-- the files come from the owner's mailboxes. Finance has no service key, so
-- the bucket's own policies let the owner's session read and write it.
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.16.0. Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-docs', 'finance-docs', false, 15728640,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/gif'])
on conflict (id) do nothing;

do $$ begin
  create policy "finance docs owner read" on storage.objects for select
    using (bucket_id = 'finance-docs' and is_finance_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance docs owner add" on storage.objects for insert
    with check (bucket_id = 'finance-docs' and is_finance_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance docs owner remove" on storage.objects for delete
    using (bucket_id = 'finance-docs' and is_finance_owner());
exception when duplicate_object then null; end $$;

create table if not exists finance_documents (
  id          uuid primary key default gen_random_uuid(),
  -- the expense it documents; null while it waits on a mail receipt
  expense_id  uuid references finance_expenses(id) on delete set null,
  -- the mail receipt it came with (finance_mail_receipts.id), if any
  receipt_id  uuid,
  path        text not null unique,
  filename    text not null,
  mime        text,
  size        integer,
  source      text not null default 'upload' check (source in ('mail', 'upload')),
  created_at  timestamptz not null default now()
);
create index if not exists finance_documents_expense_idx on finance_documents (expense_id);
create index if not exists finance_documents_receipt_idx on finance_documents (receipt_id);

alter table finance_documents enable row level security;
do $$ begin
  create policy "finance owner all" on finance_documents for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

alter table finance_mail_receipts add column if not exists docs_checked_at timestamptz;
