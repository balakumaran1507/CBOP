-- Blog & SEO module, Build Unit 4: CBOP becomes the headless CMS. blog_posts
-- is authored/managed here; GET /api/public/blog/:companyPrefix/:postSlug
-- (added in api/routes/blog.ts) is the actual endpoint an external Next.js
-- site fetches from. Revision history mirrors templates_versions' "keep last
-- 5" pattern exactly (see migrations/001_initial_schema.sql).

CREATE TABLE blog_posts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL,
  excerpt          TEXT,
  content          TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published')),
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  author_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  category         TEXT,
  tags             TEXT[] DEFAULT '{}',
  meta_title       TEXT,
  meta_description TEXT,
  og_image_url     TEXT,
  canonical_url    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, slug)
);

CREATE INDEX idx_blog_posts_company ON blog_posts(company_id);
CREATE INDEX idx_blog_posts_status ON blog_posts(status);

-- Revision history - keep last 5, same pattern as templates_versions
CREATE TABLE blog_post_versions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id    UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
  title      TEXT,
  content    TEXT,
  version    INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blog_post_versions_post ON blog_post_versions(post_id);

-- Reusable media library - posts reference these by URL in their content,
-- this table is just the library/picker source, not a per-post join.
CREATE TABLE blog_post_media (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  filename    TEXT NOT NULL,
  alt_text    TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blog_post_media_company ON blog_post_media(company_id);
