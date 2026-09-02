-- 0037 — each client names its own non-billable "Keys" task.
--
-- The studio has always written hours down to a per-client "«Client» keys" task by
-- hand before the Sunday client report. This column is what lets the app do it: the
-- client-reports hours cells offer a write-down, and this says where the hours go.
--
-- ⚠️⚠️ CHOSEN, NEVER MATCHED BY NAME, and the real data is why. Alongside the
-- expected "Anchor Keys" / "Visitt Keys" rows there are `--- Keys ---` SEPARATOR
-- tasks and two keys-shaped tasks still marked BILLABLE. Guessing from the title
-- would eventually move hours onto a separator, or onto a task that keeps billing
-- the client — the exact opposite of a write-down. Null means "no keys task chosen"
-- and the app simply does not offer the control.
--
-- ⚠️ `on delete set null`, not cascade: deleting a task must never take the client
-- row with it. The picker then reads as "none" and says so.
--
-- ⚠️ No policy work. `clients` already carries 0001's `admin all` policy plus the
-- shared read policy, and this is one more column on that table — the app writes it
-- through the same admin-gated `updateClient` path as `hour_cap` and `report_notes`.
--
-- ⚠️ Degrades gracefully: `mapClient` reads a missing column as null and
-- `updateWithOptional` drops it from the write, so before this runs the app behaves
-- exactly as it did — the Keys-task picker just cannot save, and says so.

alter table clients
  add column if not exists keys_task_id uuid references tasks(id) on delete set null;

comment on column clients.keys_task_id is
  'This client''s non-billable Keys task — the destination for hours written down before a client report. Chosen explicitly; never inferred from the task title.';
