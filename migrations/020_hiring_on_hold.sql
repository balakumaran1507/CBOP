-- Migration 020: 'on_hold' stage + fix rejection_reason silently dropped from email

-- Add on_hold as a valid stage (between interview_done and selected/rejected)
ALTER TABLE hiring_applicants DROP CONSTRAINT IF EXISTS hiring_applicants_stage_check;
ALTER TABLE hiring_applicants ADD CONSTRAINT hiring_applicants_stage_check CHECK (stage IN (
  'applied','reviewed','shortlisted',
  'interview_scheduled','interview_done',
  'on_hold',
  'selected','offer_sent','accepted',
  'onboarding','active_intern','rejected'
));

-- Default rejection_email_template (for companies created from now on) — includes
-- {{rejection_reason_line}}, a server-computed block that is empty when no reason
-- was given, so the placeholder never leaks into the sent email.
ALTER TABLE hiring_settings ALTER COLUMN rejection_email_template SET DEFAULT
E'Hi {{applicant_name}},\n\nThank you for applying for the {{role_title}} position at {{company_name}}.\n\nAfter reviewing your application, we will not be moving forward at this time.{{rejection_reason_line}}\n\nWe encourage you to continue building your skills and apply again in the future.\n\nBest,\n{{company_name}} Team';

-- Backfill existing rows that still hold the original (pre-reason-line) default —
-- skips any company that already customized its template.
UPDATE hiring_settings SET rejection_email_template =
E'Hi {{applicant_name}},\n\nThank you for applying for the {{role_title}} position at {{company_name}}.\n\nAfter reviewing your application, we will not be moving forward at this time.{{rejection_reason_line}}\n\nWe encourage you to continue building your skills and apply again in the future.\n\nBest,\n{{company_name}} Team'
WHERE rejection_email_template = E'Hi {{applicant_name}},\n\nThank you for applying for the {{role_title}} position at {{company_name}}.\n\nAfter reviewing your application, we will not be moving forward at this time.\n\nWe encourage you to continue building your skills and apply again in the future.\n\nBest,\n{{company_name}} Team';
