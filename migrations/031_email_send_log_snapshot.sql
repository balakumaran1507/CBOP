-- Migration 031: store the actual rendered HTML for every outbound email.
-- email_send_log previously only recorded subject/status — enough to know
-- *that* something sent, not what it actually looked like. This closes that
-- gap for after-the-fact audits ("what did this specific person receive?").

ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS rendered_html TEXT;
