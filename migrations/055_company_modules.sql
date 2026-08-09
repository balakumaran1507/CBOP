-- Migration 055: Company module toggles
-- Allows enabling/disabling CBOP feature modules per company.
-- New companies created after this migration must be backfilled by the
-- POST /api/settings/companies route (which inserts all modules as enabled).

CREATE TABLE IF NOT EXISTS company_modules (
  company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module_key  TEXT    NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, module_key)
);

-- Backfill: enable every module for every existing company
INSERT INTO company_modules (company_id, module_key, is_enabled)
SELECT c.id, m.key, true
FROM companies c
CROSS JOIN (VALUES
  ('finance'),
  ('mentor'),
  ('sales'),
  ('hiring'),
  ('campaigns'),
  ('blog'),
  ('seo'),
  ('social'),
  ('documents'),
  ('email_studio'),
  ('subscribers'),
  ('templates'),
  ('work'),
  ('goals'),
  ('rnd'),
  ('audit'),
  ('settings'),
  ('legal')
) AS m(key)
ON CONFLICT DO NOTHING;

-- Index for quick per-company module lookups (used on every request)
CREATE INDEX IF NOT EXISTS idx_company_modules_company_id
  ON company_modules(company_id)
  WHERE is_enabled = true;
