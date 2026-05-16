-- ============================================================================
-- Slice 9: CEO Panel additions
-- ============================================================================

-- Cash position per company (manual entry for runway calculation)
CREATE TABLE IF NOT EXISTS finance_cash_position (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  amount     NUMERIC(14,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mentor conversation history (one row per user+persona pair)
CREATE TABLE IF NOT EXISTS mentor_conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  persona    TEXT NOT NULL CHECK (persona IN ('ca','mba','marketing_advisor','tech_consultant')),
  messages   JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, persona)
);

-- 72-hour read-only share links for mentor conversations
CREATE TABLE IF NOT EXISTS mentor_share_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES mentor_conversations(id) ON DELETE CASCADE,
  token           TEXT UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
