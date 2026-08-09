-- Blog & SEO module, Build Unit 1: Google API connections. One row per
-- company per connected Google Search Console property. GA4 shares the same
-- OAuth token (requested together - one consent screen, two scopes) so it's
-- a nullable column on this table rather than a separate connections table.

CREATE TABLE seo_site_connections (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  site_url             TEXT NOT NULL,   -- GSC-verified property, e.g. https://ouantum.com/ or sc-domain:ouantum.com
  ga4_property_id      TEXT,
  google_access_token  TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  token_expires_at     TIMESTAMPTZ NOT NULL,
  connected_at         TIMESTAMPTZ DEFAULT NOW(),
  connected_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (company_id, site_url)
);

CREATE INDEX idx_seo_site_connections_company ON seo_site_connections(company_id);
