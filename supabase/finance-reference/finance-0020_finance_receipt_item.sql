-- What a receipt says was bought (v1.16.1, Nitsan 2026-11-07: "the expense's
-- description should say what it was — 'יום פינוק עם עיסוי - זוגי - Kedem
-- Spa'"). One short line read from the receipt email or its PDF, carried into
-- the expense's description on Add. Like invoice_number and paid_with
-- (reference/0018), only this line is kept — never the receipt's text.
--
-- "" = read, nothing found. Owner-only like the rest of the table (0016).
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table finance_mail_receipts add column if not exists item_description text;
