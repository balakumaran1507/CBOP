-- Open/click tracking for email_send_log. Real gap identified by research:
-- CBOP's email tooling had zero visibility into whether a sent email was ever
-- opened or clicked - the one thing every real send/campaign tool (Mailchimp,
-- Customer.io) actually has. tracking_token is generated app-side (crypto.randomUUID())
-- BEFORE the send so it can be embedded in the pixel/links, not DB-generated on insert.

ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS tracking_token UUID;
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS open_count INT NOT NULL DEFAULT 0;
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_send_log_tracking_token ON email_send_log(tracking_token) WHERE tracking_token IS NOT NULL;
