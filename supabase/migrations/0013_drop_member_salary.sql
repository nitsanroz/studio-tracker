-- 0013_drop_member_salary.sql
-- Remove the member salary field entirely. The studio does not want salary
-- data held in this system: drop the column and its data from member_hr.
-- (finance_salaries — studio-level monthly expense totals — is a separate
--  concern in the finance product and is intentionally NOT touched here.)

alter table member_hr drop column if exists salary;
