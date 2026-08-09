-- 057: Dynamic Role-Based Access Control
-- Replaces the hardcoded role→module mapping in api/lib/modules.ts with
-- a fully DB-driven system. creator remains the only hardcoded super-admin.

-- ── 1. Drop the role CHECK constraint so custom role slugs are allowed ────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- ── 2. Company-specific roles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,            -- 'sales_rep', 'ceo', 'cto'
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,  -- true = seeded by migration; not deletable
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, slug)
);

-- ── 3. Per-role module access ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_module_access (
  role_id    UUID NOT NULL REFERENCES company_roles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  can_read   BOOLEAN NOT NULL DEFAULT true,
  can_write  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, module_key)
);

-- ── 4. Link users to a company_role ──────────────────────────────────────────
-- users.role TEXT stays for backward compat with require-role.ts.
-- company_role_id is authoritative for module-level access decisions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_role_id UUID REFERENCES company_roles(id) ON DELETE SET NULL;

-- ── 5. Pending invites ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role_id       UUID NOT NULL REFERENCES company_roles(id) ON DELETE CASCADE,
  temp_password TEXT NOT NULL,    -- cleartext only until first login; cleared after
  invited_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_roles_company    ON company_roles(company_id);
CREATE INDEX IF NOT EXISTS idx_role_module_access_role  ON role_module_access(role_id);
CREATE INDEX IF NOT EXISTS idx_users_company_role        ON users(company_role_id);
CREATE INDEX IF NOT EXISTS idx_user_invites_email        ON user_invites(email);

-- ── 7. Seed system roles for every existing company ───────────────────────────
INSERT INTO company_roles (id, company_id, name, slug, is_system, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  r.name,
  r.slug,
  true,
  NOW()
FROM companies c
CROSS JOIN (VALUES
  ('CEO', 'ceo'),
  ('COO', 'coo'),
  ('CTO', 'cto')
) AS r(name, slug)
ON CONFLICT (company_id, slug) DO NOTHING;

-- ── 8. Grant all modules to CEO ───────────────────────────────────────────────
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, true
FROM company_roles cr
CROSS JOIN (VALUES
  ('finance'),('mentor'),('sales'),('hiring'),('campaigns'),('blog'),
  ('seo'),('social'),('documents'),('email_studio'),('subscribers'),
  ('templates'),('work'),('goals'),('rnd'),('audit'),('settings'),('legal')
) AS m(key)
WHERE cr.slug = 'ceo'
ON CONFLICT DO NOTHING;

-- ── 9. Grant business modules to COO ─────────────────────────────────────────
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, true
FROM company_roles cr
CROSS JOIN (VALUES
  ('sales'),('hiring'),('campaigns'),('blog'),('seo'),('social'),
  ('documents'),('email_studio'),('subscribers'),('templates'),('work'),('goals'),('rnd'),('legal')
) AS m(key)
WHERE cr.slug = 'coo'
ON CONFLICT DO NOTHING;

-- ── 10. Grant technical modules to CTO ────────────────────────────────────────
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, true
FROM company_roles cr
CROSS JOIN (VALUES
  ('work'),('goals'),('rnd'),('blog'),('seo'),('social'),
  ('documents'),('templates'),('legal')
) AS m(key)
WHERE cr.slug = 'cto'
ON CONFLICT DO NOTHING;

-- ── 11. Back-fill company_role_id for existing users ─────────────────────────
-- Match on the user's current role slug and their primary company.
-- If a user belongs to multiple companies we pick the first (by company_id)
-- for back-fill; admins can correct via the UI.
UPDATE users
SET company_role_id = (
  SELECT cr.id
  FROM company_roles cr
  JOIN user_companies uc ON uc.company_id = cr.company_id
  WHERE cr.slug = users.role
    AND uc.user_id = users.id
  LIMIT 1
)
WHERE users.role IN ('ceo', 'coo', 'cto')
  AND users.company_role_id IS NULL;
