-- Lightweight post-generation lifecycle for document_generated. Real
-- e-signature (legally binding, tamper-evident) is out of scope - this is
-- tracking only: did the recipient view it, did someone confirm they got it.

ALTER TABLE document_generated ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'generated'
  CHECK (status IN ('generated', 'sent', 'viewed', 'acknowledged'));
ALTER TABLE document_generated ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE document_generated ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Backfill: anything already flagged email_sent should read as 'sent', not 'generated'
UPDATE document_generated SET status = 'sent' WHERE email_sent = true AND status = 'generated';
