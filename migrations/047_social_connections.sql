-- Social Media Monitor prototype: connection records per company per platform.
-- Scoped to owned-account monitoring only (see docs/SOCIAL_Build_Plan.md's Phase 1
-- legal/access findings) - never broad listening/scraping. OAuth wiring per
-- platform is NOT built in this prototype pass (only the schema + UI shell are);
-- this table is ready to receive real tokens once each platform's OAuth flow is
-- built out in a follow-up round, same staged approach as the SEO module.

CREATE TABLE social_connections (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'x', 'tiktok', 'linkedin')),
  account_name         TEXT,
  account_id           TEXT,
  access_token         TEXT,
  refresh_token        TEXT,
  token_expires_at     TIMESTAMPTZ,
  connected_at         TIMESTAMPTZ DEFAULT NOW(),
  connected_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (company_id, platform, account_id)
);

CREATE INDEX idx_social_connections_company ON social_connections(company_id);

-- Historical engagement snapshots, one row per connection per day - the actual
-- data trend charts (engagement rate, follower growth) are computed from.
-- Empty until a platform is really connected and a poll/webhook writes to it.
CREATE TABLE social_engagement_snapshots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id  UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  snapshot_date  DATE NOT NULL,
  followers      INT,
  posts_count    INT,
  total_likes    INT,
  total_comments INT,
  total_shares   INT,
  total_reach    INT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, snapshot_date)
);

CREATE INDEX idx_social_engagement_connection ON social_engagement_snapshots(connection_id, snapshot_date);
