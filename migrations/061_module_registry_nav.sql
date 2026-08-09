-- 059: Module registry becomes the single source of truth for the sidebar (IF-5)
--
-- api/lib/modules.ts now carries nav metadata (space/href/icon) for every
-- feature area, and app/components/sidebar.tsx renders from that manifest
-- alone. Six nav entries that previously existed only in the sidebar's private
-- NAV_GROUPS array are now real modules and need rows in company_modules /
-- role_module_access, otherwise 057-era users (whose access is DB-driven)
-- would lose those nav entries entirely.
--
-- It also aligns role_module_access with the role model documented in
-- CLAUDE.md: COO and CTO are equal power over business data. 057 granted CTO
-- a narrower set than COO; the sidebar meanwhile showed CTO everything
-- ungated. Both are corrected here, in the DB, once.

-- ── 1. New module keys → enabled for every company ───────────────────────────
INSERT INTO company_modules (company_id, module_key, is_enabled)
SELECT c.id, m.key, true
FROM companies c
CROSS JOIN (VALUES
  ('dashboard'),
  ('accounting'),
  ('tax'),
  ('website'),
  ('people'),
  ('command')
) AS m(key)
ON CONFLICT DO NOTHING;

-- ── 2. CEO gets every new key (CEO already holds every other module) ─────────
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, true
FROM company_roles cr
CROSS JOIN (VALUES
  ('dashboard'),
  ('accounting'),
  ('tax'),
  ('website'),
  ('people'),
  ('command')
) AS m(key)
WHERE cr.slug = 'ceo'
ON CONFLICT DO NOTHING;

-- ── 3. COO + CTO: dashboard (landing page) and people (employee directory) ───
-- accounting / tax / website / command stay CEO-only, matching the gates the
-- old sidebar applied and the registry in api/lib/modules.ts.
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, m.writable
FROM company_roles cr
CROSS JOIN (VALUES
  ('dashboard', false),
  ('people',    true)
) AS m(key, writable)
WHERE cr.slug IN ('coo', 'cto')
ON CONFLICT DO NOTHING;

-- ── 4. CTO reaches parity with COO on business data ─────────────────────────
-- CLAUDE.md "Role model": coo and cto are equal power — "Both get full access
-- to every business-data route (sales, hiring, campaigns, documents, email
-- studio, subscribers, templates, work) filtered by their companyIds."
-- 057 withheld sales / hiring / campaigns / email_studio / subscribers from
-- CTO while the sidebar showed all of them, which is the drift IF-5 describes.
INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
SELECT cr.id, m.key, true, true
FROM company_roles cr
CROSS JOIN (VALUES
  ('sales'),
  ('hiring'),
  ('campaigns'),
  ('email_studio'),
  ('subscribers')
) AS m(key)
WHERE cr.slug = 'cto'
ON CONFLICT DO NOTHING;
