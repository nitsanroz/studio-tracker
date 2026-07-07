-- Weekly-plan column management: allow hiding columns without deleting them.
alter table plan_columns add column if not exists hidden boolean not null default false;
