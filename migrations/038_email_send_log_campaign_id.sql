-- Direct campaign_id correlation on email_send_log, so campaign-level open/click
-- rate aggregation is a simple GROUP BY instead of a fragile to_email+time-window join.

ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS campaign_id UUID;
CREATE INDEX IF NOT EXISTS idx_send_log_campaign ON email_send_log(campaign_id) WHERE campaign_id IS NOT NULL;
