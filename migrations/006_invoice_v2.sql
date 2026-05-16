-- Company enhancements
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan_number TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_theme JSONB DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_terms TEXT;

-- Client GST
ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS address TEXT;

-- Invoice compliance fields
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS supply_date DATE;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN DEFAULT false;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS e_way_bill_no TEXT;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '998314';
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2) DEFAULT 1;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS rate NUMERIC(12,2);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS machine_data JSONB DEFAULT '{}';

-- Backfill rate from amount
UPDATE sales_invoices SET rate = amount WHERE rate IS NULL;
UPDATE sales_invoices SET supply_date = created_at::DATE WHERE supply_date IS NULL;

-- Initialize machine_data on existing invoices
UPDATE sales_invoices SET machine_data = jsonb_build_object(
  'status', status,
  'reminder_count', 0,
  'last_reminder_at', null,
  'viewed_at', null,
  'partial_payments', '[]'::jsonb,
  'audit_flags', '[]'::jsonb,
  'e_invoice_irn', null
) WHERE machine_data = '{}';

-- Seed company themes
UPDATE companies SET invoice_theme = '{"primary":"#2B6EF5","accent":"#1A56DB","onPrimary":"#FFFFFF"}'
WHERE name ILIKE '%etherence it%' OR type = 'it';

UPDATE companies SET invoice_theme = '{"primary":"#E0141D","accent":"#B91C1C","onPrimary":"#FFFFFF"}'
WHERE name ILIKE '%pentest%' OR name ILIKE '%security%' OR type = 'security';

UPDATE companies SET invoice_theme = '{"primary":"#0A0A0A","accent":"#2A2A2A","onPrimary":"#FFFFFF"}'
WHERE name ILIKE '%cybercom%' OR type = 'ctf';

UPDATE companies SET invoice_theme = '{"primary":"#2B6EF5","accent":"#E0141D","onPrimary":"#FFFFFF"}'
WHERE name ILIKE '%attackos%' OR type = 'gamedev';
