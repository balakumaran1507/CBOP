-- Migration 059: Per-company ops alert recipients
--
-- Removes the hardcoded personal identifiers that used to page one specific
-- human for *every* company's events (scale-up plan IF-9):
--   • const ALERT_TELEGRAM_ID = '6316112708'  — duplicated verbatim in
--     api/routes/documents.ts and api/routes/email-campaigns.ts
--   • team_lead_email: 'nabeelah@etherence.com' — api/routes/templates.ts
--
-- Source of truth is now these two columns, read through api/lib/ops-alerts.ts
-- (same shape as the companies.email_branding → api/lib/company-brand.ts fix in
-- migration 051). Both are nullable: NULL means "use the platform default"
-- (OPS_ALERT_TELEGRAM_ID / OPS_ALERT_EMAIL env vars, then the built-in
-- fallback), so a newly created company keeps working with no extra setup.
--
-- The backfill below writes the previously-hardcoded values onto every existing
-- company row so behaviour is byte-identical for the current companies after
-- this migration is applied.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS ops_alert_telegram_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ops_alert_email       TEXT;

COMMENT ON COLUMN companies.ops_alert_telegram_id IS
  'Telegram chat id that receives operational alerts (document batch finished, campaign auto-paused) for this company. NULL = platform default.';
COMMENT ON COLUMN companies.ops_alert_email IS
  'Email address used as the ops/team-lead contact for this company (template previews, onboarding docs). NULL = platform default.';

-- Backfill: preserve today's behaviour for the existing companies
UPDATE companies SET ops_alert_telegram_id = '6316112708'
  WHERE ops_alert_telegram_id IS NULL;
UPDATE companies SET ops_alert_email = 'nabeelah@etherence.com'
  WHERE ops_alert_email IS NULL;
