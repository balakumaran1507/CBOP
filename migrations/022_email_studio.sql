-- Migration 022: Email Studio — extend email_designs into the global email
-- template store, extend email_send_log with design/attachment linkage,
-- track uploaded assets for the HTML-import editing mode.

-- email_designs: add authoring mode, detected variables, gallery thumbnail,
-- cross-company availability, and a pointer back to an imported Document
-- Studio template (when a design was bootstrapped from one).
ALTER TABLE email_designs
  ADD COLUMN IF NOT EXISTS content_mode      TEXT NOT NULL DEFAULT 'richtext'
    CHECK (content_mode IN ('richtext', 'html')),
  ADD COLUMN IF NOT EXISTS variables         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS thumbnail_url     TEXT,
  ADD COLUMN IF NOT EXISTS is_global         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES templates(id) ON DELETE SET NULL;

-- company_id was NOT NULL-by-convention but not enforced; global designs
-- (internal/system emails not tied to one company) need it nullable.
ALTER TABLE email_designs ALTER COLUMN company_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_designs_category ON email_designs(category);
CREATE INDEX IF NOT EXISTS idx_email_designs_company  ON email_designs(company_id);

-- email_send_log: link a send back to the design + any attachments used,
-- so the Email Studio Activity tab can show full context per send.
ALTER TABLE email_send_log
  ADD COLUMN IF NOT EXISTS design_id       UUID REFERENCES email_designs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_refs JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_send_log_design ON email_send_log(design_id);

-- email_design_assets: uploaded images / source HTML per design, so the
-- HTML-import mode can show "what's attached to this design" and let you
-- re-open/re-map assets later instead of only rewriting HTML once on import.
CREATE TABLE IF NOT EXISTS email_design_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id     UUID REFERENCES email_designs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image', 'html_source')),
  original_name TEXT,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_design_assets_design ON email_design_assets(design_id);
