-- hiring_batches: one row per batch interview session
CREATE TABLE IF NOT EXISTS hiring_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id),
  role_id         UUID REFERENCES hiring_roles(id),
  created_by      UUID REFERENCES users(id),
  meet_link       TEXT NOT NULL,
  batch_name      TEXT,
  slot_duration   INT NOT NULL DEFAULT 15,   -- minutes per candidate
  buffer_minutes  INT NOT NULL DEFAULT 2,    -- gap between candidates
  scheduled_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','complete','cancelled')),
  current_index   INT NOT NULL DEFAULT 0,    -- which candidate is currently being interviewed (0-based)
  panel           JSONB DEFAULT '[]',        -- [{user_id, name}]
  notes           TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- hiring_batch_candidates: ordered list of candidates in a batch
CREATE TABLE IF NOT EXISTS hiring_batch_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES hiring_batches(id) ON DELETE CASCADE,
  applicant_id    UUID NOT NULL REFERENCES hiring_applicants(id),
  position        INT NOT NULL,              -- 1-based order in the batch
  estimated_at    TIMESTAMPTZ,               -- computed: scheduled_at + (position-1) * (slot_duration + buffer)
  invited_at      TIMESTAMPTZ,              -- when "prep email" was sent
  turn_sent_at    TIMESTAMPTZ,               -- when "it's your turn" message was sent
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','current','done','skipped')),
  interview_notes TEXT,
  decision        TEXT CHECK (decision IN ('accept','reject','hold')),
  decided_at      TIMESTAMPTZ,
  whatsapp_sent   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hiring_batch_candidates_batch ON hiring_batch_candidates(batch_id, position);
CREATE INDEX IF NOT EXISTS idx_hiring_batches_company ON hiring_batches(company_id, status);

CREATE TRIGGER set_hiring_batches_updated_at
  BEFORE UPDATE ON hiring_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
