-- 0048 — "new lead" alerts.
--
-- A lead that arrived from the website form and nobody has opened yet is
-- counted in the header bell and on the sidebar's Leads item, the way an
-- unread intake brief is.
--
-- `seen_at` DEFAULTS TO now(), so every existing lead and every lead an admin
-- creates by hand (or a script imports) is born already seen. Only the public
-- website-form route inserts `seen_at = null`, and it clears it again when the
-- same person writes in a second time. Opening the lead stamps it.
--
-- No policy work: `leads` is already admin-only (`admin all`, 0042).

alter table leads add column if not exists seen_at timestamptz default now();
alter table leads add column if not exists seen_by uuid references profiles(id) on delete set null;

notify pgrst, 'reload schema';
