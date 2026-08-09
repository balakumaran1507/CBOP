-- Tax & Compliance page: filing deadline tracker. Due dates are fixed by law,
-- not computed - this is a checklist/calendar the user marks done, not automation.
CREATE TABLE tax_filings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  filing_type  TEXT NOT NULL,   -- GSTR-1, GSTR-3B, ITR, TDS, etc - free text, not a fixed enum
  period       TEXT NOT NULL,   -- e.g. "2026-06" or "FY2025-26"
  due_date     DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filed', 'overdue')),
  filed_at     TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tax_filings_company ON tax_filings(company_id);
CREATE INDEX idx_tax_filings_due ON tax_filings(due_date);

-- Legal page: contract lifecycle tracking. CBOP already generates contracts/NDAs/MOUs
-- via templates + Document Studio but never tracked what happened after generation -
-- no status, no counterparty, no expiry. This is the actual gap, not document generation itself.
CREATE TABLE legal_contracts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID REFERENCES companies(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  counterparty          TEXT,
  contract_type         TEXT NOT NULL DEFAULT 'contract' CHECK (contract_type IN ('contract', 'nda', 'mou', 'other')),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'active', 'expired')),
  effective_date        DATE,
  expiry_date           DATE,
  renewal_reminder_days INT DEFAULT 30,
  source_template_id    UUID REFERENCES templates(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_legal_contracts_company ON legal_contracts(company_id);
CREATE INDEX idx_legal_contracts_expiry ON legal_contracts(expiry_date);
