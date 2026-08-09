-- Build Unit 3: in-house technical SEO auditor. No external API - CBOP's own
-- crawler checks title/meta/headings/alt-text/broken-links/robots.txt/viewport
-- and stores a scored result per audit run.

CREATE TABLE technical_seo_audits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  score       INT NOT NULL CHECK (score >= 0 AND score <= 100),
  issues      JSONB NOT NULL DEFAULT '[]',
  audited_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_technical_seo_audits_company ON technical_seo_audits(company_id, audited_at DESC);
