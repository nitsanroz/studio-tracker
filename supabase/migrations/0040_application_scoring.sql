-- 0040 — which subjects can be judged before anybody has met them.
--
-- Scoring the application is not an interview and never was: it is a first
-- opinion formed from the mail, the CV and the portfolio, BEFORE any contact.
-- v1.53.0 modelled it as an interview card you had to add by hand, which got
-- the shape right and the moment wrong — a judgement you have already formed by
-- the time you finish reading is not something you opt in to recording.
--
-- The one thing that genuinely differs at that moment is WHAT CAN BE JUDGED.
-- "Communication", "Energy", "Fit with the studio", "Takes feedback" are
-- readings of a person, and a portfolio is not a person. Scoring them from a
-- PDF is guessing, and a guess recorded as a number outlives the hesitation
-- that produced it.
--
-- ⚠️ A FLAG PER SUBJECT, NOT A HARDCODED "SKIP PERSONALITY". The subjects are
-- Nitsan's to rename, retire and add to in Settings (0039), so a rule that
-- matched on the name 'Personality' would silently stop working the day he
-- renamed it — and would have no answer at all for a subject he adds later.
alter table candidate_score_subjects
  add column if not exists from_submission boolean not null default true;

-- ⚠️ DEFAULT TRUE, and this UPDATE is the only exception. A new subject is
-- assumed judgeable from the work unless somebody says otherwise: getting that
-- wrong shows an extra column that can be left blank, where the other way round
-- hides a column with no hint that it exists.
update candidate_score_subjects set from_submission = false where name = 'Personality';
