-- 0062 — freelancer_logs.approved: the line as it was last approved (v1.89.0).
--
-- Since v1.88.0 an approved line can change after approval — the freelancer
-- edits it on their page (back to pending), or an admin edits it on the
-- freelancer page. Its tracker time entry then has to follow. But that entry may
-- no longer equal the line: a Keys write-down shrinks it (or moves it whole to
-- the client's Keys task) while the freelancer is still paid the full hours.
-- Copying the line's figures onto the entry would silently undo the write-down.
--
-- So each approved line keeps a snapshot of what was approved —
-- {date, minutes, description, task_id, client_id, task_hint} — and a change is
-- applied to the entry as a DIFFERENCE (minutes += new − approved), date and
-- note copied, task moved only if the entry still sits on the approved task.
-- Turning a change down restores the line from this snapshot.
--
-- Optional vs deploy: without it the app takes the snapshot from the time
-- entry, which is right unless Keys took some of that line.

alter table freelancer_logs add column if not exists approved jsonb;

update freelancer_logs
set approved = jsonb_build_object(
  'date', date,
  'minutes', minutes,
  'description', description,
  'task_id', task_id,
  'client_id', client_id,
  'task_hint', task_hint
)
where status = 'approved' and approved is null;
