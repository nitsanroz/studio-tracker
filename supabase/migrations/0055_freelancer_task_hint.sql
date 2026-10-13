-- 0055 — a freelancer can NAME the task in his own words. Nitsan, 2026-10-13.
--
-- 0054 let him pick only a task an admin had already filed one of his logs on.
-- Nitsan: "freelance can insert free text, so he can name a task — I will
-- assign it to the right client, right task, and he will see it changed; next
-- time he can select it on his own." So a log carries his wording beside the
-- task the admin files it on. The client becomes optional too (column was
-- already nullable): he may not know which client record it belongs to.
--
-- Filing a log on a client he wasn't enabled for enables it (the review
-- route does that), so the task shows in his picker next time.

alter table freelancer_logs add column if not exists task_hint text;
alter table freelancer_logs drop constraint if exists freelancer_logs_task_hint_len;
alter table freelancer_logs add constraint freelancer_logs_task_hint_len check (task_hint is null or length(task_hint) <= 120);
