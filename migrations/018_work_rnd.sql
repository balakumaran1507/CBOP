-- ── Migration 018: Work streams + R&D ─────────────────────────────────────────
-- Adds work_type to projects (client / internal), makes company_id nullable
-- for internal projects, and introduces rnd_initiatives + rnd_log_entries.

-- 1. Add work_type to ops_projects
ALTER TABLE ops_projects
  ADD COLUMN IF NOT EXISTS work_type VARCHAR(20) NOT NULL DEFAULT 'client';

-- 2. Make company_id nullable so internal projects don't need a client
ALTER TABLE ops_projects
  ALTER COLUMN company_id DROP NOT NULL;

-- 3. R&D initiatives
CREATE TABLE IF NOT EXISTS rnd_initiatives (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  domain         VARCHAR(50)  NOT NULL DEFAULT 'other',
  -- exploring | active | paused | concluded
  status         VARCHAR(20)  NOT NULL DEFAULT 'exploring',
  company_id     UUID         REFERENCES companies(id),
  outcome        TEXT,
  tags           TEXT[]       NOT NULL DEFAULT '{}',
  created_by_id  UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4. Log entries per initiative
CREATE TABLE IF NOT EXISTS rnd_log_entries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID        NOT NULL REFERENCES rnd_initiatives(id) ON DELETE CASCADE,
  body           TEXT        NOT NULL,
  -- note | experiment | finding | prototype | milestone | blocker
  entry_type     VARCHAR(20) NOT NULL DEFAULT 'note',
  created_by_id  UUID        REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rnd_initiatives_status ON rnd_initiatives(status);
CREATE INDEX IF NOT EXISTS idx_rnd_initiatives_domain ON rnd_initiatives(domain);
CREATE INDEX IF NOT EXISTS idx_rnd_log_entries_initiative ON rnd_log_entries(initiative_id);

-- 5. Updated_at trigger for initiatives
CREATE OR REPLACE FUNCTION update_rnd_initiatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rnd_initiatives_updated_at ON rnd_initiatives;
CREATE TRIGGER trg_rnd_initiatives_updated_at
  BEFORE UPDATE ON rnd_initiatives
  FOR EACH ROW EXECUTE FUNCTION update_rnd_initiatives_updated_at();
