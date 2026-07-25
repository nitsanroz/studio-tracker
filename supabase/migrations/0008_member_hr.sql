-- ── 0008: private HR details per team member (admins only) ──────────────────
-- Mirrors the studio's HR sheet. Deliberately NOT on profiles (which every
-- authenticated user can read) — ID stay behind admin-only RLS.

create table if not exists member_hr (
  profile_id uuid primary key references profiles(id) on delete cascade,
  national_id text,
  gender text,
  birth_date date,
  personal_email text,
  phone text,
  street text,
  house_no text,
  floor text,
  apartment text,
  city text,
  zip text,
  marital_status text,
  emergency_contact_name text,
  emergency_contact_phone text,
  updated_at timestamptz not null default now()
);
alter table member_hr enable row level security;
do $$ begin
  create policy "admin all" on member_hr for all using (is_admin());
exception when duplicate_object then null; end $$;

-- seed from the HR sheet (matched by profile name; skips names not found)
insert into member_hr (profile_id, national_id, gender, birth_date, personal_email, phone, street, house_no, floor, apartment, city, zip, marital_status, emergency_contact_name, emergency_contact_phone)
select p.id, v.national_id, v.gender, v.birth_date::date, v.personal_email, v.phone, v.street, v.house_no, v.floor, v.apartment, v.city, v.zip, v.marital_status, v.ec_name, v.ec_phone
from (values
  ('nitsan%',  '040855744', 'זכר',  '1981-03-15', 'nitsanroz@gmail.com',          '052-8364260',  'ניצנה',       '20',  '5',  '27',  'ת״א',    null,      'נשוי +2', 'אנה',          '0546517951'),
  ('nadav%',   '203740733', 'זכר',  '1991-12-04', 'nadav@halevi.co.il',           '0547405266',   'י.ל. פרץ',    '29',  '3',  '15',  'ת״א',    null,      'רווק', 'מלאני',        '0548073263'),
  ('dmitry%',  '340953991', 'זכר',  '1993-06-15', 'ostrovich.d@gmail.com',        '058-7728572',  'וינגייט',     '3',   '13', '147', 'ת״א',    null,      'נשוי',    'אסתר',         '0587003575'),
  ('aki%',     '207477167', 'זכר',  '1999-07-14', 'aki12234@gmail.com',           '052-447-7235', 'הרצל',        '121', '7',  '41',  'ת״א',    null,      'נשוי',    'לידייז',       '0534448025'),
  ('daniel%',  '322468828', 'נקבה', '2000-09-20', 'Danielkramash292@gmail.com',   '054-573-7785', 'דיזינגוף',    '233', '4',  '11',  'ת״א',    '6311607', 'רווקה',    'מוטי (אבא)',   '0544573778'),
  ('adaya%',   '208255885', 'נקבה', '1998-12-03', 'adaya31298@gmail.com',         '054-831-1933', 'שלום עליכם',  '50',  '2',  '10',  'ת״א',    null,      'רווקה',    'עידו',         '0542782020'),
  ('sefi%',    '209399674', 'זכר',  '1998-01-08', 'sefibo87@gmail.com',           '050-8103471',  'השקמה',       '8ב',  null, '1',   'בת ים',  null,      'רווק',    'ילנה (אמא)',   '0506853026'),
  ('leeyam%',  '316515592', 'נקבה', null,         'leeyam.greenberg@gmail.com',   '054-316-6831', 'כצנלסון',     '75 ה׳','0', '1',   'גבעתיים', null,     'נשואה',    null,           null)
) as v(name_pat, national_id, gender, birth_date, personal_email, phone, street, house_no, floor, apartment, city, zip, marital_status, ec_name, ec_phone)
join profiles p on p.name ilike v.name_pat
on conflict (profile_id) do nothing;
