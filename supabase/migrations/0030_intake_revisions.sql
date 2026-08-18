-- 0030 — a client's later change to a brief becomes a REVISION the studio
-- reviews, and can never quietly overwrite work already done.
--
-- The problem this solves, in Nitsan's words: "what happens if i get an update
-- to a brief i already turned into a task, edited its text and refined it as i
-- wish… i want to see what changed and deal with changes with carefulness not
-- erasing edits i already made."
--
-- answers_ack  the client's answers AS THE STUDIO LAST ACKNOWLEDGED THEM —
--              written when an admin marks a brief seen or approves it. This is
--              the reference point a diff is computed against, and it is the
--              whole idea: without it the app can only say "something changed",
--              and with it it can say exactly WHAT changed since you last read
--              this. One mechanism covers both cases — a pending brief you had
--              already read, and an approved one you have since refined into a
--              task in your own words.
-- acked_at     when that snapshot was taken. A brief needs review when
--              `edited_at > acked_at` (or acked_at is null and edited_at isn't),
--              which is one rule for every status rather than a flag per case.
--
-- ⚠️ NOTHING HERE TOUCHES `tasks`. An approved brief's revision updates only the
-- request row; the task keeps the text the studio wrote. Applying any part of a
-- revision to a task is an explicit action in the queue, never a side effect.
--
-- ⚠️ No policy or trigger work, for the third migration running: `task_requests`
-- is admin-only for ALL operations under 0001's `admin all` policy, and every
-- public path to it is a service-role route that checks the intake token. 0011's
-- trigger guards `tasks`, not this table.
--
-- Degrades gracefully: existing rows have a null `answers_ack`, so the first
-- revision of an old brief reports "no earlier version was recorded" and shows
-- the submission whole instead of a diff.
alter table task_requests add column if not exists answers_ack jsonb;
alter table task_requests add column if not exists acked_at timestamptz;

-- The queue's "needs your attention" read: find edited briefs cheaply without
-- scanning, whatever their status.
create index if not exists task_requests_edited_idx on task_requests (edited_at)
  where edited_at is not null;
