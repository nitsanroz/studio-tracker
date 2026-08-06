-- ── 0023: timeline row order + client icons ─────────────────────────────────
-- Two additions behind the v1.3.0 batch:
--
--   1. `tasks.timeline_position` — a row order for the client Timeline that is
--      INDEPENDENT of `tasks.position`. Nitsan chose a separate order
--      deliberately: `position` is per-section and drives the Tasks tab, so
--      sharing it would mean dragging a Timeline row could silently move the
--      task into another section.
--   2. `clients.icon` / `clients.icon_url` — a client mark: either one of the
--      app's preset glyphs (`icon`, a name from CLIENT_ICONS) or an uploaded
--      image (`icon_url`). `icon_url` wins when both are set. Colour continues
--      to live in the existing `clients.color`.
--
-- ⚠️ As in 0022, the 0011 trigger has to be re-declared. It enumerates its
-- protected columns BY NAME, so `timeline_position` would otherwise be
-- member-writable — and the Timeline is admin-editable by design.
-- `clients.*` needs no such care: the whole table is already admin-write.

alter table tasks add column if not exists timeline_position int;

alter table clients add column if not exists icon text;
alter table clients add column if not exists icon_url text;

-- Re-declare with timeline_position added. Everything else is character-for-
-- character 0011 + 0022's start_date line — see 0011 for the reasoning.
create or replace function enforce_task_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;  -- admins may change anything
  end if;

  if new.title        is distinct from old.title
  or new.estimate_hours is distinct from old.estimate_hours
  or new.due_date     is distinct from old.due_date
  or new.start_date   is distinct from old.start_date        -- added by 0022
  or new.timeline_position is distinct from old.timeline_position  -- added by 0023
  or new.billable     is distinct from old.billable
  or new.status       is distinct from old.status
  or new.completed_at is distinct from old.completed_at
  or new.client_id    is distinct from old.client_id
  or new.section_id   is distinct from old.section_id
  or new.assignee_id  is distinct from old.assignee_id
  or new.pending      is distinct from old.pending
  or new.project_id   is distinct from old.project_id
  or new.everhour_id  is distinct from old.everhour_id
  or new.asana_gid    is distinct from old.asana_gid
  then
    raise exception 'members cannot modify protected task fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;  -- brief / figma_url / tag_id / position are allowed
end;
$$;
