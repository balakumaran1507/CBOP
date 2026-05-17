-- Migration 008: Invoice PDF v3 — new columns for enhanced template

-- sales_invoices: PO number, discount, balance due
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS po_number       TEXT;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2);

-- Backfill balance_due for existing rows (unpaid = full total; paid = 0)
UPDATE sales_invoices
SET balance_due = CASE WHEN status = 'paid' THEN 0 ELSE total END
WHERE balance_due IS NULL;

-- companies: street address and seal image path
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address      TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_seal TEXT;
