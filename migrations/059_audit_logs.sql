-- Migration 059: Generalized, append-only audit_logs
--
-- audit_logs was created in 001_initial_schema.sql with four indexes and never
-- had a single writer anywhere in api/. This migration generalizes it into the
-- platform-wide audit trail and makes it append-only at the database level.
--
-- The design is the same one documented for acct_audit_log in
-- docs/ACCOUNTING_Build_Plan.md, widened so it can also record events that are
-- not row mutations (auth, authorization denials, exports, agent tool calls).
-- There is deliberately only ONE audit table design in this codebase.
--
-- Column meanings:
--   action        dot-namespaced event name — 'auth.sign_in.success',
--                 'authz.role.denied', 'admin.company.update', 'mcp.tool.call',
--                 'export.invoice_pdf', or plain 'insert'/'update'/'delete'
--                 when written by the generic row trigger below.
--   resource_type table name for row events; otherwise the kind of thing acted
--                 on ('route', 'module', 'mcp_tool', 'company', 'user', ...).
--   resource_id   TEXT, not UUID — resources include module keys, tool names
--                 and route paths as well as row ids.
--   actor_role    role snapshot at the time of the action. Roles change; this
--                 must never be re-derived by joining users after the fact.
--   before_json / after_json
--                 row state for mutations. For non-mutation events (auth,
--                 denials, tool calls, exports) the event payload — deny
--                 reason, tool arguments, attempted resource — lives in
--                 after_json.
--
-- Retention: append-only. Nothing in CBOP purges this table. DPDP Rule 6(4)
-- wants >= 1 year, CERT-In 2022 wants 180 days rolling; we keep the union of
-- both, which is "everything". Do not add a purge job without a legal review.

-- ── 1. Rename the 001 columns to the generalized names ───────────────────────
-- Guarded so a partially-applied run can be re-run safely.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'audit_logs' AND column_name = 'user_id') THEN
    ALTER TABLE audit_logs RENAME COLUMN user_id TO actor_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'audit_logs' AND column_name = 'table_name') THEN
    ALTER TABLE audit_logs RENAME COLUMN table_name TO resource_type;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'audit_logs' AND column_name = 'old_val') THEN
    ALTER TABLE audit_logs RENAME COLUMN old_val TO before_json;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'audit_logs' AND column_name = 'new_val') THEN
    ALTER TABLE audit_logs RENAME COLUMN new_val TO after_json;
  END IF;
END $$;

-- ── 2. New columns ───────────────────────────────────────────────────────────

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role  TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id TEXT;
-- ip_address is TEXT, not INET: it comes from X-Forwarded-For and must never
-- be able to fail an insert on a malformed value. An unparseable IP is still
-- evidence.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address  TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent  TEXT;

-- ── 3. Widen `action` ────────────────────────────────────────────────────────
-- 001 constrained action to insert/update/delete. The audit log now records
-- auth events, authorization denials, exports and agent tool calls, so the
-- CHECK is dropped rather than extended with an ever-growing allowlist.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;

-- Must run BEFORE the immutability trigger exists (the trigger blocks UPDATE).
UPDATE audit_logs SET action = 'unknown' WHERE action IS NULL;

ALTER TABLE audit_logs ALTER COLUMN action     SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN created_at SET DEFAULT NOW();

-- Both foreign keys are dropped, deliberately, and actor_id / company_id become
-- plain UUIDs. Two reasons, and they compound:
--   1. An audit row must outlive the user or company it refers to. That is the
--      whole point of an actor_role *snapshot*.
--   2. Any FK action would fight the immutability trigger below: ON DELETE SET
--      NULL issues an UPDATE against audit_logs (blocked → the user/company
--      delete fails), and ON DELETE CASCADE would let deleting a user erase
--      their own audit trail — precisely the attack the trigger exists to stop.
-- Deleting a referenced row therefore leaves a dangling id, which is correct:
-- the evidence records who acted, not who currently exists.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_company_id_fkey;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
-- Column renames keep the old index names but not their usefulness; the two
-- single-column indexes from 001 are subsumed by the composites below.

DROP INDEX IF EXISTS idx_audit_logs_user;
DROP INDEX IF EXISTS idx_audit_logs_table;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ── 5. Append-only enforcement ───────────────────────────────────────────────
-- This trigger, not REVOKE, is the authoritative mechanism: CBOP runs a single
-- Postgres role (cbop_user) for both migrations and runtime, and a table owner
-- bypasses REVOKE on its own tables, so REVOKE alone would be a no-op here.
-- Blocks every role including the one the application connects as.

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ── 6. Generic row-level writer ──────────────────────────────────────────────
-- Attach to any table that needs a full before/after edit history:
--
--   CREATE TRIGGER trg_<table>_audit AFTER INSERT OR UPDATE OR DELETE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();
--
-- It reads the actor from the transaction-local GUCs that api/lib/db.ts sets
-- inside transaction() from the AsyncLocalStorage context established once in
-- requireAuth. A statement that runs outside transaction() (plain query())
-- records a NULL actor — so any table wired to this trigger must be mutated
-- through transaction().
--
-- No triggers are attached by this migration: the application-level writer in
-- api/lib/audit-log.ts covers the event classes IF-2 requires. This function
-- exists so that per-table row history (accounting, and anything else that
-- needs it later) reuses this design instead of inventing a second one.

CREATE OR REPLACE FUNCTION cbop_write_audit_log() RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  BEGIN
    v_company_id := (to_jsonb(COALESCE(NEW, OLD))->>'company_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  INSERT INTO audit_logs (
    actor_id, actor_role, company_id, action,
    resource_type, resource_id, before_json, after_json
  )
  VALUES (
    NULLIF(current_setting('cbop.current_user_id', true), '')::UUID,
    NULLIF(current_setting('cbop.current_role', true), ''),
    v_company_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id)::TEXT,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
