-- Company lifecycle fixes (audit: "onboarding a company is a nightmare").
--
-- 1. is_active — safe deactivation. Every FK to companies(id) is ON DELETE
--    CASCADE, so there is deliberately no hard-delete path anywhere in the
--    app; this column is the alternative. Defaults true so every existing
--    row (and every row inserted before this migration is applied) stays
--    visible/functional with zero backfill required.
--
-- 2. email_branding — centralizes the per-company email branding
--    (accent/bg/tagline/signoff) that used to be hardcoded, byte-for-byte
--    duplicated, in api/routes/hiring.ts and api/routes/hiring-batches.ts
--    (COMPANY_BRAND consts). logo_initials (migration 011) already covers
--    the `initials` field, so it isn't repeated here. Both files now read
--    through api/lib/company-brand.ts instead.
--
-- 3. Backfill logo_initials + email_branding for the 4 seeded companies so
--    removing the hardcoded maps produces byte-identical email output.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_branding JSONB;

-- Etherence IT (logo_initials already 'E2' via migration 011 — branding only)
UPDATE companies SET email_branding = '{"accent":"#0073BB","bg":"#F0F7FF","tagline":"Technology. Delivered.","signoff":"The Etherence IT Team"}'::jsonb
  WHERE id = '11111111-1111-1111-1111-111111111111' AND email_branding IS NULL;

UPDATE companies SET
  logo_initials = COALESCE(logo_initials, 'EP'),
  email_branding = '{"accent":"#B91C1C","bg":"#FFF5F5","tagline":"Secure. Test. Protect.","signoff":"The Etherence Pentest Team"}'::jsonb
  WHERE id = '22222222-2222-2222-2222-222222222222' AND email_branding IS NULL;

UPDATE companies SET
  logo_initials = COALESCE(logo_initials, 'CC'),
  email_branding = '{"accent":"#0D9488","bg":"#F0FDFA","tagline":"Compete. Learn. Defend.","signoff":"The CYBERCOM CTF Team"}'::jsonb
  WHERE id = '33333333-3333-3333-3333-333333333333' AND email_branding IS NULL;

UPDATE companies SET
  logo_initials = COALESCE(logo_initials, 'AOS'),
  email_branding = '{"accent":"#D97706","bg":"#FFFBEB","tagline":"Offense-first Security.","signoff":"The AttackOS Team"}'::jsonb
  WHERE id = '44444444-4444-4444-4444-444444444444' AND email_branding IS NULL;
