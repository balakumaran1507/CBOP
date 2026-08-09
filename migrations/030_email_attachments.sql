-- Migration 030: reusable email attachment library + "always attach these"
-- on a batch — the multi-PDF-attachment feature. Previously the system could
-- only attach exactly one PDF (the recipient's own generated document) to an
-- email. This adds:
--   1. A reusable static-file library (upload once — company brochure, T&Cs,
--      price list — reuse across many sends without re-uploading).
--   2. Per-batch "extra attachments" that ride along with every recipient's
--      own generated PDF, not just it alone.

CREATE TABLE IF NOT EXISTS email_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL = usable from any company
  name         TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   INT,
  uploaded_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_company ON email_attachments(company_id);

ALTER TABLE document_batches
  ADD COLUMN IF NOT EXISTS extra_attachment_ids UUID[] NOT NULL DEFAULT '{}';
