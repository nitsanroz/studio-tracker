-- ── 0047: undoable lead delete ────────────────────────────────────────────
-- Nitsan, 2026-10-03, after deleting Unibeam by mistake: a hard delete cascades
-- to contacts, offers, threads, events and estimates and has no undo (Leads
-- live outside the store's ⌘Z). Deleting now stamps these two columns and
-- hides the lead everywhere (board, search, digest, Gmail matching, website-
-- form dedupe), so the board's Undo banner can bring it back. It is erased for
-- good when that banner is dismissed, or by the app once 10 minutes pass.
-- No bin to browse, by Nitsan's choice.

alter table leads add column if not exists deleted_at timestamptz;
alter table leads add column if not exists deleted_by uuid references profiles(id) on delete set null;

create index if not exists leads_deleted_at_idx on leads (deleted_at) where deleted_at is not null;

notify pgrst, 'reload schema';
