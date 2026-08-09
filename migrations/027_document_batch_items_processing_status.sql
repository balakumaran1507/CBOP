-- Migration 027: add a 'processing' status so an item can be durably marked
-- "someone is working on this" for the full duration of PDF-gen + email-send,
-- not just an instant. Without this, two overlapping runPendingItems() calls
-- (e.g. a double-clicked Resume) could both pick up the same recipient.

ALTER TABLE document_batch_items DROP CONSTRAINT IF EXISTS document_batch_items_status_check;
ALTER TABLE document_batch_items ADD CONSTRAINT document_batch_items_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'failed'));
