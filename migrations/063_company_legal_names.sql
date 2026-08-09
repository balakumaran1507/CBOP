-- 063_company_legal_names.sql
-- Adds the registered legal entity name per company, distinct from the trading
-- name in `companies.name`. Confirmed with Bala 2026-08-05: Etherence IT and
-- Etherence Pentest are two trading names under ONE legal entity (Etherence
-- Security Private Limited) — this is why legal_name is not simply a rename
-- of `name`, and why two rows can share the same legal_name value.
-- Feeds ACCT-3 in docs/Project-Scale-Up-Plan.md (chart of accounts stays
-- per-company-row; legal_name is what actually determines GSTIN/PAN/ROC
-- grouping, not the row itself).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name TEXT;

UPDATE companies SET legal_name = 'Etherence Security Private Limited'
  WHERE name IN ('Etherence IT', 'Etherence Pentest') AND legal_name IS NULL;

UPDATE companies SET legal_name = 'Cybercom Labs Private Limited'
  WHERE name = 'CYBERCOM CTF' AND legal_name IS NULL;

UPDATE companies SET legal_name = 'AttackOS Studios Private Limited'
  WHERE name = 'AttackOS' AND legal_name IS NULL;

UPDATE companies SET legal_name = 'Ouantum AI Private Limited'
  WHERE name = 'Ouantum' AND legal_name IS NULL;

UPDATE companies SET legal_name = 'Zapsters IT Solutions Private Limited'
  WHERE name = 'Zapsters' AND legal_name IS NULL;

COMMENT ON COLUMN companies.legal_name IS
  'Registered legal entity name (ROC/GSTIN/PAN holder). Distinct from `name`, '
  'the trading/brand name used in nav, invoices header and UI. Two company '
  'rows MAY share one legal_name (e.g. Etherence IT + Etherence Pentest both '
  'trade under Etherence Security Private Limited) — do not assume 1:1 with `name`.';
