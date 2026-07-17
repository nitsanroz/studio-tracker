-- ── 0009: client-level billable flag ────────────────────────────────────────
-- Internal clients (Studio, OFFF…) are never billable; new tasks inherit this.
alter table clients add column if not exists billable boolean not null default true;
update clients set billable = false where name in ('Studio', 'OFFF tlv');
