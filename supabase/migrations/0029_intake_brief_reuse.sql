-- 0029 — let a client edit a brief they already submitted.
--
-- Two plain columns and nothing else. `task_requests` is already admin-only for
-- ALL operations under 0001's `admin all` policy, and every public path to it
-- goes through a service-role route that checks the token — so there is no
-- policy work here, and no trigger work either (0011's trigger guards `tasks`,
-- not `task_requests`).
--
-- edit_key   an unguessable secret, minted per submission and returned ONCE.
--            The client's own browser keeps it in localStorage; the edit route
--            requires it. This is what makes editing safe on an unauthenticated
--            form whose URL gets pasted into client emails: there is no lookup
--            by email address, so there is nothing to enumerate, and holding
--            the link alone reaches nobody's brief. (The same reasoning that
--            kept v1.14.0 from adding an email→identity endpoint.)
-- edited_at  when the client last changed it after submitting. The queue shows
--            this: an admin who has already read a brief must not be left
--            reading silently stale text.
--
-- Degrades gracefully: before this is applied the submission route simply has
-- no key to return, so the form offers "duplicate" (which needs no server
-- write) and not "edit".
alter table task_requests add column if not exists edit_key text;
alter table task_requests add column if not exists edited_at timestamptz;

-- Editing looks a brief up by (id, edit_key). The id is the primary key, so
-- this index is about the KEY: it keeps a wrong key cheap to reject.
create index if not exists task_requests_edit_key_idx on task_requests (edit_key);
