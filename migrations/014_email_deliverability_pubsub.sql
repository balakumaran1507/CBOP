-- 014 — Email deliverability, pub/sub subscribers, suppression, audit, design studio
-- Idempotent: reconciles schema drift (email_recipients / email_unsubscribes /
-- marketing_campaigns columns were created live, never captured in a migration).

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Reconcile marketing_campaigns (001 created only 7 columns; code uses ~15)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS subject       TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS body_html     TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS body_text     TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS sender_email  TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS reply_to      TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS total_count   INTEGER DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS valid_count   INTEGER DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS invalid_count INTEGER DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS sent_count    INTEGER DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS failed_count  INTEGER DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS list_id       UUID; -- optional pub/sub list source
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS design_id     UUID; -- optional design-studio source
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS spam_score    NUMERIC(5,2);

-- Capture the live-created campaign child tables so a clean DB matches prod.
CREATE TABLE IF NOT EXISTS email_recipients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed
  error       TEXT,
  merge_data  JSONB,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign ON email_recipients(campaign_id, status);

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  email       TEXT PRIMARY KEY,
  campaign_id UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Verified sending domains — drives the verified-domain guard in mailer.ts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_domains (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain      TEXT UNIQUE NOT NULL,
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  provider    TEXT NOT NULL DEFAULT 'google_workspace', -- google_workspace|ses|resend|forwarding
  from_email  TEXT,            -- default From for this domain, e.g. founders@cybercomctf.com
  smtp_env    TEXT,            -- name of the .env credential block, e.g. CYBERCOM / OUANTUM / ZAPSTERS
  verified    BOOLEAN NOT NULL DEFAULT FALSE, -- gate: false → CBOP refuses to send as this domain
  spf_ok      BOOLEAN,
  dkim_ok     BOOLEAN,
  dmarc_ok    BOOLEAN,
  last_checked TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the current reality (2026-06-13 audit). verified = can send cleanly today.
INSERT INTO email_domains (domain, provider, from_email, smtp_env, verified, spf_ok, dkim_ok, dmarc_ok) VALUES
  ('cybercomctf.com', 'google_workspace', 'founders@cybercomctf.com', 'CYBERCOM',  TRUE,  TRUE,  TRUE,  FALSE),
  ('ouantum.com',     'google_workspace', 'founders@ouantum.com',     'OUANTUM',   TRUE,  TRUE,  TRUE,  FALSE),
  ('zapsters.in',     'google_workspace', 'founders@zapsters.in',     'ZAPSTERS',  TRUE,  FALSE, TRUE,  FALSE),
  ('etherence.com',   'forwarding',       'founders@etherence.com',   'ETHERENCE', FALSE, FALSE, FALSE, FALSE),
  ('attackos.com',    'forwarding',       'founders@attackos.com',    'ATTACKOS',  FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (domain) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Pub/Sub — subscribers + lists + membership
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_subscribers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID REFERENCES companies(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  name           TEXT,
  status         TEXT NOT NULL DEFAULT 'subscribed', -- pending|subscribed|unsubscribed|bounced|complained
  source         TEXT,           -- import|signup_form|hiring|manual|api
  merge_data     JSONB DEFAULT '{}'::jsonb,
  confirm_token  TEXT,           -- for double opt-in
  confirmed_at   TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, email)
);
CREATE INDEX IF NOT EXISTS idx_subscribers_company_status ON email_subscribers(company_id, status);

CREATE TABLE IF NOT EXISTS email_lists (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  double_optin BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_list_members (
  list_id       UUID REFERENCES email_lists(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES email_subscribers(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, subscriber_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Suppression list — single source of truth for "never email this address"
--    Generalizes email_unsubscribes (unsub | bounce | complaint | manual).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_suppression (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL = global suppression
  reason     TEXT NOT NULL DEFAULT 'unsubscribe', -- unsubscribe|bounce|complaint|manual
  detail     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, company_id)
);
CREATE INDEX IF NOT EXISTS idx_suppression_email ON email_suppression(email);

-- Backfill existing unsubscribes into the new suppression table.
INSERT INTO email_suppression (email, reason)
SELECT email, 'unsubscribe' FROM email_unsubscribes
ON CONFLICT (email, company_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Outbound audit log — every email CBOP sends (transactional + campaign)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_send_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,            -- campaign|hiring|document|transactional|auth
  to_email    TEXT NOT NULL,
  from_email  TEXT,
  subject     TEXT,
  status      TEXT NOT NULL,            -- sent|failed|blocked|suppressed
  spam_score  NUMERIC(5,2),
  reason      TEXT,                     -- failure / block reason
  message_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_send_log_created ON email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_company ON email_send_log(company_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Email design studio — reusable, branded, multipart templates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_designs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT,
  design_json JSONB DEFAULT '{}'::jsonb, -- block model from the visual builder
  html        TEXT,                       -- compiled, email-safe HTML
  text        TEXT,                       -- plaintext alternative
  category    TEXT,                       -- campaign|hiring|transactional|onboarding
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_designs_company ON email_designs(company_id);
