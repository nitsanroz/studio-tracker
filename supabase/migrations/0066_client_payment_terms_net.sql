-- "Net+30" is not "30 days" (Nitsan, 2026-11-10).
--
-- 0065 gave each client a number of days to pay, counted from the invoice. That
-- is right for the studio's usual 14 days, but Maccabi pays NET+30 (שוטף+30):
-- the clock starts at the END of the invoice's month, and the money then comes in
-- the payment run on the 1st–5th — an invoice sent on 20 Oct is paid around
-- 1–5 Dec, 40–45 days later, not on 19 Nov. A plain 30 called it late every month.
--
-- `payment_terms_net = true` reads `payment_terms_days` as net+N: due the 5th of
-- the month that payment run falls in (see `paymentDue` in lib/payment-terms.ts,
-- in BOTH apps). False (the default) keeps "N days after the invoice".
--
-- Safe to re-run. Both apps read a missing column as false.

alter table clients
  add column if not exists payment_terms_net boolean not null default false;

update clients set payment_terms_net = true
 where name = 'Maccabi' and payment_terms_days = 30;
