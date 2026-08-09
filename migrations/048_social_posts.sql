-- Social Media Manager (publishing): distinguishes which LinkedIn identity a
-- connection posts as (Path A: personal profile / Path B: company page - see
-- docs/SOCIAL_Build_Plan.md's "Social Media Manager" section for the R&D
-- behind the two paths) and the actual queue of drafted/scheduled/published
-- posts. AI-drafted content is never auto-published - status starts at
-- 'draft' until a human hits Publish.

ALTER TABLE social_connections
  ADD COLUMN connection_type TEXT CHECK (connection_type IN ('member', 'organization'));

CREATE TABLE social_posts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  connection_id    UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  content          TEXT NOT NULL,
  media_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  external_post_urn TEXT,
  ai_generated     BOOLEAN NOT NULL DEFAULT false,
  source_type      TEXT CHECK (source_type IN ('blog_post', 'job_listing', 'manual')),
  source_id        UUID,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_social_posts_company ON social_posts(company_id, status);
CREATE INDEX idx_social_posts_connection ON social_posts(connection_id);
