-- 0041 — a score of 0 is a real opinion.
--
-- 0039 declared `check (value between 1 and 10)`, on the reasoning that the
-- scale starts at 1 and a blank means "not scored". The first half was a guess
-- and Nitsan corrected it: some answers really are a zero, and forcing a 1
-- overstates them.
--
-- ⚠️⚠️ THIS DOES NOT WEAKEN THE RULE THAT AN UNSCORED PARAMETER IS ABSENT.
-- That rule is what stops a skipped question dragging an interview's average
-- down (see `interviewAverage`), and it is enforced by the ROW not existing —
-- `setScore(null)` still DELETES. 0 and absent stay different claims: absent
-- renders as "—" and counts toward nothing, 0 renders as 0 and counts as a
-- zero. Anything that starts treating a missing row as 0 re-breaks the thing
-- 0039 was careful about, whatever this constraint says.
alter table candidate_scores drop constraint if exists candidate_scores_value_check;
alter table candidate_scores add constraint candidate_scores_value_check check (value between 0 and 10);
