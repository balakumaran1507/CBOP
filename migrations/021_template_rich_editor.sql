-- Migration 021: Rich editor fields for templates + company logos

-- Templates: add Tiptap JSON content, output type, page config, slug
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS content_json  JSONB,
  ADD COLUMN IF NOT EXISTS output_type   TEXT NOT NULL DEFAULT 'pdf'
    CHECK (output_type IN ('pdf', 'email', 'both')),
  ADD COLUMN IF NOT EXISTS page_config   JSONB NOT NULL DEFAULT
    '{"margins":{"top":72,"right":72,"bottom":72,"left":72},"pageSize":"A4","headerHtml":"","footerHtml":""}',
  ADD COLUMN IF NOT EXISTS slug          TEXT UNIQUE;

-- Template versions: carry JSON snapshot too
ALTER TABLE templates_versions
  ADD COLUMN IF NOT EXISTS content_json JSONB;

-- Companies: logo image path (local filesystem)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logo_url TEXT;
