-- Migration 024: reusable email signatures for Email Studio's compose editor.
-- Company-scoped (or global) blocks of rich HTML, insertable at the cursor or
-- auto-appended when composing a design — same idea as Gmail's signatures.

CREATE TABLE IF NOT EXISTS email_signatures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL = usable from any company
  name        TEXT NOT NULL,
  html        TEXT NOT NULL DEFAULT '',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_signatures_company ON email_signatures(company_id);
