-- Migration 023: stable slug for Email Studio designs, so transactional code
-- paths (hiring.ts, internal/n8n send-email) can look up a design by a fixed
-- name instead of a UUID — same convention as templates.slug (migration 021).

ALTER TABLE email_designs ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
