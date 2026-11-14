-- Where to get the invoice (v1.17.0, Nitsan 2026-11-07: "if a mail doesn't
-- contain the invoice, only a button to log in and get it from their system,
-- give the button directing to that place"). The https link on the receipt
-- email's "View invoice" / "Log in" button, for receipts with no file
-- attached (Cloudflare). Only the link is kept, never the email's text.
--
-- Owner-only like the rest of the table (0016). Run once in the Supabase SQL
-- editor. Safe to re-run.

alter table finance_mail_receipts add column if not exists invoice_url text;
