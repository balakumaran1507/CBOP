-- Migration 012: Hiring Module (Hermes)

-- Ouantum company (5th company)
INSERT INTO companies (name, type, invoice_prefix)
VALUES ('Ouantum', 'ai', 'QNT')
ON CONFLICT DO NOTHING;

-- Hiring roles configuration
CREATE TABLE IF NOT EXISTS hiring_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id),
  title           TEXT NOT NULL,
  role_type       TEXT CHECK (role_type IN (
                    'full_stack','front_end','back_end','cloud',
                    'devops','red_blue_team','auditing','marketing',
                    'ctf_author','security_research','game_dev',
                    '3d_art','ml_engineering','ai_research'
                  )),
  employment_type TEXT CHECK (employment_type IN ('intern_unpaid','intern_paid','full_time')) DEFAULT 'intern_unpaid',
  is_technical    BOOLEAN DEFAULT true,
  description     TEXT,
  required_skills TEXT[],
  preferred_skills TEXT[],
  min_year        INT DEFAULT 3,
  active          BOOLEAN DEFAULT true,
  slots           INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Applicants
CREATE TABLE IF NOT EXISTS hiring_applicants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id),
  role_id         UUID REFERENCES hiring_roles(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  college         TEXT,
  year_of_study   INT,
  resume_url      TEXT,
  resume_text     TEXT,
  portfolio_url   TEXT,
  linkedin_url    TEXT,
  github_url      TEXT,
  source          TEXT DEFAULT 'manual',

  -- AI scoring
  ai_score        INT DEFAULT 0,
  ai_score_breakdown JSONB DEFAULT '{}',
  ai_summary      TEXT,
  ai_scored_at    TIMESTAMPTZ,

  -- Pipeline
  stage           TEXT DEFAULT 'applied' CHECK (stage IN (
                    'applied','reviewed','shortlisted',
                    'interview_scheduled','interview_done',
                    'selected','offer_sent','accepted',
                    'onboarding','active_intern','rejected'
                  )),
  rejection_reason TEXT,
  rejection_sent_at TIMESTAMPTZ,
  rejection_queued_at TIMESTAMPTZ,

  -- Review
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,

  -- Interview
  interview_at    TIMESTAMPTZ,
  interview_meet_link TEXT,
  interview_panel JSONB DEFAULT '[]',
  interview_notes TEXT,
  interview_outcome TEXT CHECK (interview_outcome IN ('pass','fail','pending')),

  -- Offer
  offer_letter_url TEXT,
  offer_sent_at   TIMESTAMPTZ,
  offer_accepted  BOOLEAN,
  offer_responded_at TIMESTAMPTZ,

  -- Onboarding
  slack_invited_at TIMESTAMPTZ,
  discord_invited_at TIMESTAMPTZ,
  wiki_page_url   TEXT,
  onboarded_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Intern records (after onboarding)
CREATE TABLE IF NOT EXISTS intern_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id    UUID REFERENCES hiring_applicants(id),
  company_id      UUID REFERENCES companies(id),
  role_id         UUID REFERENCES hiring_roles(id),
  team_lead_id    UUID REFERENCES users(id),
  start_date      DATE,
  end_date        DATE,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','completed','terminated')),
  performance_notes TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Hiring settings per company
CREATE TABLE IF NOT EXISTS hiring_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) UNIQUE,
  rejection_delay_hours INT DEFAULT 48,
  auto_reject_threshold INT DEFAULT 25,
  auto_shortlist_threshold INT DEFAULT 75,
  rejection_email_template TEXT,
  interview_email_template TEXT,
  offer_email_template TEXT,
  welcome_email_template TEXT,
  google_calendar_id TEXT,
  slack_workspace_invite_url TEXT,
  discord_invite_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER set_hiring_applicants_updated_at
  BEFORE UPDATE ON hiring_applicants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hiring_applicants_stage   ON hiring_applicants(stage);
CREATE INDEX IF NOT EXISTS idx_hiring_applicants_company ON hiring_applicants(company_id);
CREATE INDEX IF NOT EXISTS idx_hiring_applicants_role    ON hiring_applicants(role_id);
CREATE INDEX IF NOT EXISTS idx_hiring_applicants_score   ON hiring_applicants(ai_score DESC);
