-- An expense's paperwork (v1.15.1, Nitsan 2026-11-06: "populate details such
-- as invoice number or way of payment or what credit card used"):
--
--   finance_expenses.invoice_number — the invoice or receipt number.
--   finance_expenses.paid_with      — what paid it: "Visa ••3562", "Bank transfer".
--   finance_mail_receipts.invoice_number / paid_with — the same, read from a
--     receipt email, carried onto the row it becomes.
--
-- Free text, both optional; the Expenses page edits them from each row's
-- receipt icon. Columns only — RLS is the tables' own (Expenses keeps its
-- expenses-only access for Michal). Safe to re-run.

alter table finance_expenses add column if not exists invoice_number text;
alter table finance_expenses add column if not exists paid_with text;

alter table finance_mail_receipts add column if not exists invoice_number text;
alter table finance_mail_receipts add column if not exists paid_with text;
