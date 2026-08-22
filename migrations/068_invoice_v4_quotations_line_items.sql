-- Migration 068: Invoice/Quotation v4 — line items, GST modes, quotations,
-- editable compliance fields.
--
-- Context: sales_invoices previously supported exactly one line
-- (rate/quantity/service_description), a hardcoded 18% GST rate computed in
-- application code, a hardcoded "Place of Supply: Tamil Nadu (33)" string in
-- the PDF template, and no document type other than a tax invoice. This
-- migration adds what's needed for: multi-line invoices/quotations with
-- per-item and overall discounts, a "no GST" mode and an explicit round-off
-- toggle, and editable per-document compliance fields that used to be
-- hardcoded or entirely absent.

-- ── sales_invoices: document type ───────────────────────────────────────────

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'invoice'
  CHECK (doc_type IN ('invoice', 'quotation'));

-- Quotations use their own lifecycle instead of draft/sent/paid/overdue.
-- Widening the existing status CHECK rather than keeping two constraints -
-- doc_type already scopes which subset of values is meaningful per row.
ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_status_check;
ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_status_check
  CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'accepted', 'rejected', 'expired'));

-- Quotation this invoice was converted from, if any (nullable, no FK cascade -
-- the source quotation's own lifecycle is independent of the invoice created
-- from it).
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS source_quotation_id UUID REFERENCES sales_invoices(id);

-- ── sales_invoices: dates ────────────────────────────────────────────────────
-- invoice_date was previously derived at render time from created_at::DATE
-- (api/lib/pdf-generator.ts) and was never a real, editable column.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS invoice_date DATE;
UPDATE sales_invoices SET invoice_date = created_at::DATE WHERE invoice_date IS NULL;
ALTER TABLE sales_invoices ALTER COLUMN invoice_date SET NOT NULL;
ALTER TABLE sales_invoices ALTER COLUMN invoice_date SET DEFAULT CURRENT_DATE;

-- Quotations show "Valid Until" instead of "Due Date" in the UI/PDF; due_date
-- stays the column invoices use.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS valid_until DATE;

-- ── sales_invoices: GST modes ────────────────────────────────────────────────
-- gst_amount was previously always computed as amount * 0.18 in
-- api/routes/invoices.ts with no way to charge zero GST or a different rate.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS gst_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (gst_mode IN ('standard', 'none'));
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18;
-- Total is rounded to the nearest whole rupee when true; the existing PDF
-- template already has a conditional "Rounding" totals row for exactly this
-- (api/lib/pdf-generator.ts computes `rounding = total - (taxable + gst)`),
-- it was just never settable - round_off is what now drives that gap.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS round_off BOOLEAN NOT NULL DEFAULT false;

-- ── sales_invoices: discounts ────────────────────────────────────────────────
-- Per-item discounts live on sales_invoice_items below; this is the
-- document-level discount applied after item discounts, before tax.
-- discount_amount (added in migration 008) stays as the resolved ₹ amount
-- for display/back-compat; these two columns are how it's now computed.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS overall_discount_type TEXT
  CHECK (overall_discount_type IN ('flat', 'percent'));
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS overall_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── sales_invoices: compliance fields that were hardcoded or missing ────────

-- Was a hardcoded literal 'Tamil Nadu (33)' in api/lib/pdf-generator.ts
-- regardless of which state the company or client was actually in. Now
-- editable per document; NULL/blank means the PDF omits the line entirely
-- rather than showing something false.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS place_of_supply TEXT;

-- "Net 14" was a hardcoded literal in the PDF template's Terms row,
-- independent of the actual due_date offset. Now editable per document.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_terms_label TEXT DEFAULT 'Net 14';

-- Per-document Terms & Conditions override. Falls back to companies.invoice_terms
-- (added in migration 006) when NULL, which itself falls back to a hardcoded
-- default string in api/lib/pdf-generator.ts - that fallback chain is
-- unchanged, this just adds the per-document level on top of it.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS terms_conditions TEXT;

-- Whether the company GSTIN prints on this document at all (a "no GST" mode
-- document from an unregistered entity should not show a GSTIN it doesn't
-- have reason to display), and an optional override of the client's stored
-- GSTIN for this document only.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS show_company_gstin BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS client_gstin_override TEXT;

-- ── companies: quotation numbering ───────────────────────────────────────────
-- Quotations get their own sequence, distinguished by prefix, using the same
-- per-company-per-year advisory-lock pattern as generateInvoiceNumber() in
-- api/routes/invoices.ts (parameterize that function by prefix - no new
-- sequence table needed, invoice_no's UNIQUE constraint already covers both
-- document types since the prefixes never collide).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS quotation_prefix TEXT;
UPDATE companies SET quotation_prefix = invoice_prefix || '-QUO' WHERE quotation_prefix IS NULL;
ALTER TABLE companies ALTER COLUMN quotation_prefix SET NOT NULL;

-- ── Line items ────────────────────────────────────────────────────────────────
-- Replaces the single rate/quantity/service_description/hsn_code columns as
-- the source of truth for what's actually on the document. Those legacy
-- columns are left in place (existing dashboard/report queries read
-- sales_invoices.amount directly) but are no longer what the PDF renders.

CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id    UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  sort_order    INT NOT NULL DEFAULT 0,
  description   TEXT NOT NULL,
  hsn_code      TEXT,
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL,
  discount_type TEXT CHECK (discount_type IN ('flat', 'percent')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- quantity * unit_price, less this item's own discount. Pre-tax. The
  -- authoritative per-line amount - computed and stored at write time by the
  -- API (not a generated column) so historical PDFs remain byte-stable even
  -- if the discount formula changes later.
  amount        NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);

-- Backfill: every existing invoice becomes a single line item from its legacy
-- rate/quantity/service_description/hsn_code columns, using the already-
-- stored `amount` as the line amount (not rate*quantity - for old rows those
-- can disagree by a cent with what was actually billed, and `amount` is what
-- every existing total was computed from, so it's the accurate source).
INSERT INTO sales_invoice_items (invoice_id, sort_order, description, hsn_code, quantity, unit_price, amount)
SELECT id, 0, COALESCE(NULLIF(service_description, ''), 'Professional Services'), hsn_code,
       COALESCE(quantity, 1), COALESCE(rate, amount), amount
FROM sales_invoices
WHERE amount IS NOT NULL
  AND id NOT IN (SELECT DISTINCT invoice_id FROM sales_invoice_items);
