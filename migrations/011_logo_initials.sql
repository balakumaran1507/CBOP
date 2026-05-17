-- Migration 011: Custom logo initials override per company
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_initials TEXT;

-- Set Etherence IT to E2
UPDATE companies SET logo_initials = 'E2' WHERE name ILIKE '%etherence it%';
