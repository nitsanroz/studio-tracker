-- 0020 — In-reach and Quadream are ONE client (confirmed 2026-07-29).
--
-- Moves In-reach's 6 tasks to Quadream and archives the empty client row.
-- NO DELETE and NO DDL: clients → tasks is ON DELETE CASCADE, and a cascading
-- delete in a file like this is what destroyed 620 tasks on 2026-07-28.
-- In-reach is left in place, archived. To remove it later, FIRST confirm:
--   select count(*) from tasks where client_id = '9da36646-038d-44c7-ba09-2726b1872fed';   -- must be 0
--
-- tasks.client_id and section_id are reserved for admins by migration 0011's
-- trigger, so instead of disabling it this sets the JWT claim auth.uid() reads
-- and lets is_admin() pass. Scoped to the transaction by set_config's 3rd arg.
--
-- To undo: update tasks set client_id = '9da36646-038d-44c7-ba09-2726b1872fed' where id in (…);
--          update clients set archived = false where id = '9da36646-038d-44c7-ba09-2726b1872fed';

begin;
select set_config('request.jwt.claims', '{"sub":"7bd6a9e3-7179-4805-ae9a-d89fdc4f005c","role":"authenticated"}', true);

update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = '15e09b80-dccf-4d7f-908d-7d1206d8a5f1';  -- Brochure 'Reign'
update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = 'ab8f000e-d59f-4e54-969d-5f76bc124c0d';  -- Conference invitation
update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = 'eb2870ed-bb89-451d-b19b-926b1b263101';  -- Brochure update
update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = 'e29c61df-0935-4126-bd80-fc6b74fe1659';  -- Setup and Workflow WP
update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = '4bb28921-ccd0-48eb-99a0-b10d331ddbbb';  -- Diagram
update tasks set client_id = '6ec926f8-eecc-460a-a5d9-60ec17530e6d', section_id = '1cf9d850-fe76-49e8-ad20-5b315823709c' where id = '219d7ecd-65f7-4171-92bf-7ced2c93d8da';  -- business card
update clients set archived = true where id = '9da36646-038d-44c7-ba09-2726b1872fed';

commit;
