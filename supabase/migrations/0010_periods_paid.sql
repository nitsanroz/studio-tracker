-- ── 0010: payment-period paid flag, client invoice day, custom report columns ──

-- strikethrough "paid" state on payment periods
alter table client_billing_periods add column if not exists paid boolean not null default false;

-- free-text invoice day-of-month per client ("15th", "1st"…), shown on Reports
alter table clients add column if not exists invoice_note text not null default '';

-- admin-edited report column date ranges (overrides the auto week buckets)
alter table report_links add column if not exists custom_weeks jsonb;
