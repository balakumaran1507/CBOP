-- Migration 028: backfill document_batch_items for batches created before
-- migration 025 introduced that table. Those older batches only have rows in
-- document_generated (the historical per-recipient record) — the new
-- resumable-batch UI reads exclusively from document_batch_items, so without
-- this backfill they show up as empty / "0 sent" even though real sends
-- happened.
--
-- Only backfills what's recoverable: a document_generated row means that
-- recipient was actually attempted. Recipients that were never started before
-- the interrupting restart have no persisted data anywhere (the original
-- upload only ever lived in the request body) and cannot be recovered — for
-- those batches, total_count is brought down to match what's actually
-- backfilled so the batch reaches a consistent 'done' state instead of an
-- unreachable progress bar, and error_message notes the gap.

DO $$
DECLARE
  b RECORD;
  backfilled INT;
BEGIN
  FOR b IN
    SELECT * FROM document_batches
    WHERE id NOT IN (SELECT DISTINCT batch_id FROM document_batch_items WHERE batch_id IS NOT NULL)
  LOOP
    INSERT INTO document_batch_items (batch_id, seq, recipient_data, status, document_generated_id, updated_at)
    SELECT
      b.id,
      row_number() OVER (ORDER BY dg.created_at) - 1,
      dg.recipient_data,
      CASE WHEN dg.pdf_path IS NOT NULL THEN 'done' ELSE 'failed' END,
      dg.id,
      dg.created_at
    FROM document_generated dg
    WHERE dg.batch_id = b.id;

    GET DIAGNOSTICS backfilled = ROW_COUNT;

    IF backfilled > 0 THEN
      UPDATE document_batches
      SET total_count = backfilled,
          done_count = backfilled,
          status = 'done',
          error_message = CASE
            WHEN b.total_count > backfilled THEN
              format('Backfilled from legacy data on 2026-07-11 — %s of the original %s recipients predate per-recipient persistence and could not be recovered.', b.total_count - backfilled, b.total_count)
            ELSE b.error_message
          END
      WHERE id = b.id;
    END IF;
  END LOOP;
END $$;
