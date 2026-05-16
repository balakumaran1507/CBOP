-- Slice 4: Add service_description and notes to sales_invoices for PDF rendering
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS service_description TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;
