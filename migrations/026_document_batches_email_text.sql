-- Migration 026: persist the legacy subject/message text on document_batches
-- too, so *every* batch-creation path (not just the Email Studio design path)
-- is resumable — including the programmatic callers in mcp.ts/hiring.ts/
-- hiring-batches.ts that still pass raw subject/message instead of a design.

ALTER TABLE document_batches
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_message TEXT;
