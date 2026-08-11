-- ── 0028: intake read-receipts ──────────────────────────────────────────────
-- Behind "Tell client we've seen it" on a submission in the Intake Queue.
--
-- Three plain columns and nothing else. Unusually for this repo there is no
-- policy work and no trigger amendment:
--
--   · `task_requests` is admin-only for ALL operations already — 0001 declares
--     `create policy "admin all" on task_requests for all using (is_admin())`,
--     and `for all` covers the update these columns exist for.
--   · The 0011 `enforce_task_member_columns` trigger guards `tasks`, not
--     `task_requests`, so a new column here needs nothing added to it. (Every
--     new column on `tasks` still does — see 0022/0023/0027.)
--
-- ⚠️ TWO stamps, not one, and the distinction is load-bearing. If Resend is
-- down the request must still register as SEEN — an admin did read it, and
-- leaving the row untouched because a mail server was unreachable would make
-- the queue lie about what has been looked at, so the next admin acknowledges
-- it all over again. `client_notified_at` is the separate fact, and it is what
-- guarantees a client is never emailed the same acknowledgement twice.

alter table task_requests add column if not exists seen_at timestamptz;
alter table task_requests add column if not exists seen_by uuid references profiles(id) on delete set null;
alter table task_requests add column if not exists client_notified_at timestamptz;
