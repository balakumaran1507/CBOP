-- Migration 054: Settings Studios — Email Signatures enhanced,
-- Automation Rules, Template subject/category for the Settings hub.

-- ── Email Signatures: add variable list ──────────────────────────────────────
-- Already created in 024; we extend it here with trackable variable slots
-- so the UI can show which placeholders this signature contains.
ALTER TABLE email_signatures
  ADD COLUMN IF NOT EXISTS variables TEXT[] NOT NULL DEFAULT '{}';

-- ── Templates: email subject + category ──────────────────────────────────────
-- The templates table is used for both PDF docs and email templates; until
-- now the settings studios had no way to store an email subject line or a
-- UI-facing category. Adding both here.
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS subject  TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IS NULL OR category IN (
      'transactional', 'marketing', 'hiring', 'notification',
      'contract', 'proposal', 'report', 'certificate', 'other'
    ));

-- ── Automation Rules ─────────────────────────────────────────────────────────
-- One rule = one trigger + one action.  Rules fire in CBOP or n8n when the
-- trigger condition is matched.  action_config carries all config the action
-- handler needs (template_id, email_to_field, etc.).
CREATE TABLE IF NOT EXISTS automation_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  trigger_type      TEXT NOT NULL CHECK (trigger_type IN (
    'project.completed',
    'deal.closed_won',
    'invoice.paid',
    'lead.created'
  )),
  trigger_condition JSONB NOT NULL DEFAULT '{}',
  action_type       TEXT NOT NULL CHECK (action_type IN (
    'generate_certificate',
    'send_email',
    'create_task',
    'notify_team'
  )),
  action_config     JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_company   ON automation_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger   ON automation_rules(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active    ON automation_rules(is_active);

CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
