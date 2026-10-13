-- 0057 — a freelancer can add extra charges to his bill. Nitsan, 2026-10-13.
--
-- AB sometimes brings in another freelancer and charges the studio for him —
-- his sheet carried them as lines: "AMIR — anecdotes sound, 200 USD" →
-- €178.76, "AMIR SFX — NoTraffic sounds, 150 USD" → €134.07 (he wrote them in
-- as "hours" at €45 to make the sum work). They are money, not hours: a title,
-- an amount and a currency, added to the month's bill on top of hours × rate.
--
-- Same review as his hours: he adds one through his link (`pending`), an admin
-- approves or turns it down on his page; a turned-down charge leaves the bill.
-- `source = 'sheet'` for the ones imported from his sheet. Admin-only RLS; his
-- page goes through /api/log/[token] with the service key.

create table if not exists freelancer_charges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references freelancers(profile_id) on delete cascade,
  date date not null,
  title text not null check (length(trim(title)) > 0 and length(title) <= 120),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'EUR' check (currency in ('EUR', 'USD', 'ILS')),
  -- e.g. the original amount when he converted it ("200 USD").
  note text check (note is null or length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'link' check (source in ('link', 'sheet')),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists freelancer_charges_profile_date_idx on freelancer_charges (profile_id, date);

alter table freelancer_charges enable row level security;
drop policy if exists "admin all" on freelancer_charges;
create policy "admin all" on freelancer_charges for all using (is_admin()) with check (is_admin());
