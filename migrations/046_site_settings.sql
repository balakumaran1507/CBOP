-- Build Unit 6: Site/Organization Settings. Separate from `companies`
-- (billing/invoice identity: gstin/upi_id/bank_details/invoice address) -
-- this is public-facing website content: what a visitor sees and what
-- LocalBusiness/Organization JSON-LD is generated from. One row per company.

CREATE TABLE site_settings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  tagline         TEXT,
  favicon_url     TEXT,
  phone           TEXT,
  email           TEXT,
  address_street  TEXT,
  address_city    TEXT,
  address_state   TEXT,
  address_postal  TEXT,
  address_country TEXT DEFAULT 'IN',
  hours           JSONB NOT NULL DEFAULT '{}',    -- { "mon": "9:00-18:00", ... } or {} for "not set"
  social_links    JSONB NOT NULL DEFAULT '[]',    -- [{ "platform": "linkedin", "url": "..." }, ...]
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE site_team_members (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  title          TEXT,
  photo_url      TEXT,
  bio            TEXT,
  email          TEXT,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_site_team_members_company ON site_team_members(company_id, display_order);
