-- 0051: the whole time_entries history in ONE response, packed.
--
-- Boot used to page `time_entries` 1,000 rows at a time — ~25 requests of
-- ~0.5s each, the bulk of the loading screen. This returns the same rows the
-- app's `entrySums` holds, in one call, with the repeated task and user ids
-- sent once each and referenced by index:
--
--   { "tasks": [task_id…], "users": [user_id…],
--     "rows":  [[id, taskIdx, userIdx|null, date, minutes, flags]…] }
--   flags: 1 = legacy, 2 = date_estimated
--
-- SECURITY INVOKER (the default, stated): the caller's own RLS on time_entries
-- applies, exactly as the paged select did. Not totals — grouping by task,
-- person and day barely shrinks the table (24,013 → 23,794 rows, measured
-- 2026-10-05), and every screen reads per-row dates.

create or replace function public.entry_sums_packed()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  with e as (
    select id, task_id, user_id, date, minutes, legacy, date_estimated
    from time_entries
    where minutes is not null
  ),
  t as (
    select task_id, (row_number() over (order by task_id)) - 1 as i
    from (select distinct task_id from e) x
  ),
  u as (
    select user_id, (row_number() over (order by user_id)) - 1 as i
    from (select distinct user_id from e where user_id is not null) x
  )
  select json_build_object(
    'tasks', (select coalesce(json_agg(task_id order by i), '[]'::json) from t),
    'users', (select coalesce(json_agg(user_id order by i), '[]'::json) from u),
    'rows', (
      select coalesce(json_agg(json_build_array(
        e.id, t.i, u.i, e.date, e.minutes,
        (case when e.legacy then 1 else 0 end) + (case when e.date_estimated then 2 else 0 end)
      ) order by e.id), '[]'::json)
      from e
      join t on t.task_id = e.task_id
      left join u on u.user_id = e.user_id
    )
  );
$$;

grant execute on function public.entry_sums_packed() to authenticated;

notify pgrst, 'reload schema';
