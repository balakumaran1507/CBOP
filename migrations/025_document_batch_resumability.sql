-- Migration 025: durable, resumable Document Studio batches.
--
-- The problem: recipient lists only ever existed in the HTTP request body /
-- server memory during generation. If the server process died mid-batch
-- (crash, restart, deploy), everything not yet processed was gone forever —
-- no way to see who was pending, resume, retry, or even know their names.
-- This happened twice in one day (2026-07-11).
--
-- The fix: persist every recipient as its own row *before* processing starts,
-- with a status that survives any restart. runBatch() becomes resumable by
-- construction — it always just asks "which items for this batch are still
-- pending?" instead of iterating an in-memory array.

CREATE TABLE IF NOT EXISTS document_batch_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID REFERENCES document_batches(id) ON DELETE CASCADE,
  seq                   INT NOT NULL,               -- original row order in the uploaded file
  recipient_data        JSONB NOT NULL,              -- the full mapped row (name, email, custom tags...)
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  document_generated_id UUID REFERENCES document_generated(id) ON DELETE SET NULL,
  error_message         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_batch_items_batch  ON document_batch_items(batch_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_batch_items_seq ON document_batch_items(batch_id, seq);

-- document_batches: which design was used (so Resume/Retry can replay it
-- exactly) and a pause flag the running loop checks between recipients.
ALTER TABLE document_batches
  ADD COLUMN IF NOT EXISTS email_design_id UUID REFERENCES email_designs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
