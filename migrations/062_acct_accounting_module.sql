-- Migration 062: CBOP Accounting — double-entry ledger core
--
-- Design and full reasoning trail: docs/modules/ACCOUNTING_Build_Plan.md (originally
-- proposed as migration 059; renumbered — 059 was taken by the platform-wide
-- audit_logs generalization that shipped first as one of the pivot's
-- Immediate Fixes). That migration's append-only pattern (trigger, not
-- REVOKE — cbop_user owns every table, so REVOKE alone is a no-op) is reused
-- here rather than re-invented; see acct_audit_log below.
--
-- Scope: per-company chart of accounts and journal ledger (companies.id, not
-- tenants.id — the tenant boundary above companies does not exist in the
-- schema yet, that's Project-Scale-Up-Plan.md Phase 2). This is intentional
-- and forward-compatible: Phase 2 will add companies.tenant_id via an
-- expand/contract migration per constraint C24, and every acct_* table below
-- inherits tenant scoping for free through its company_id FK — no rework
-- needed here today.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Chart of accounts — per company
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acct_chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES acct_chart_of_accounts(id) ON DELETE RESTRICT,
  account_code    TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  account_subtype TEXT,   -- free text e.g. 'current_asset','fixed_asset','current_liability','cogs' - grouping/reporting only
  normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_group        BOOLEAN NOT NULL DEFAULT false,  -- header/control account, not directly postable
  is_active       BOOLEAN NOT NULL DEFAULT true,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, account_code)
);
CREATE INDEX IF NOT EXISTS idx_acct_chart_of_accounts_company ON acct_chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_acct_chart_of_accounts_parent  ON acct_chart_of_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_acct_chart_of_accounts_type    ON acct_chart_of_accounts(account_type);

DROP TRIGGER IF EXISTS trg_acct_chart_of_accounts_updated_at ON acct_chart_of_accounts;
CREATE TRIGGER trg_acct_chart_of_accounts_updated_at
  BEFORE UPDATE ON acct_chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Fiscal periods — per company, month granularity, locking
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acct_fiscal_periods (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_type  TEXT NOT NULL DEFAULT 'month' CHECK (period_type IN ('month', 'quarter')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  label        TEXT NOT NULL,   -- e.g. '2026-04' or 'FY2025-26 Q1'
  locked_at    TIMESTAMPTZ,
  locked_by    UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, period_start, period_end),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_acct_fiscal_periods_company ON acct_fiscal_periods(company_id);
CREATE INDEX IF NOT EXISTS idx_acct_fiscal_periods_range   ON acct_fiscal_periods(company_id, period_start, period_end);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Journal entries + lines
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acct_journal_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_no          TEXT NOT NULL,          -- {COMPANY_CODE}-JE-{YEAR}-{SEQUENCE}, e.g. ETH-JE-2026-0001
  entry_date        DATE NOT NULL,
  fiscal_period_id  UUID REFERENCES acct_fiscal_periods(id),
  reference         TEXT,                   -- free text, e.g. "Invoice ETH-2026-0001"
  narration         TEXT,
  source_type       TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source_type IN ('invoice', 'bill', 'expense', 'payment', 'manual', 'opening_balance')),
  source_id         UUID,                   -- polymorphic - points into sales_invoices/acct_bills/finance_expenses per source_type, no FK
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id),
  void_reason       TEXT,
  reversal_of_id    UUID REFERENCES acct_journal_entries(id),  -- set on the reversal entry created when voiding a posted entry
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, entry_no)
);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_company ON acct_journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_date    ON acct_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_status  ON acct_journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_source  ON acct_journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_period  ON acct_journal_entries(fiscal_period_id);

DROP TRIGGER IF EXISTS trg_acct_journal_entries_updated_at ON acct_journal_entries;
CREATE TRIGGER trg_acct_journal_entries_updated_at
  BEFORE UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS acct_journal_entry_lines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_entry_id UUID NOT NULL REFERENCES acct_journal_entries(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denormalized, must match parent entry (trigger-enforced)
  line_no          INT NOT NULL,
  account_id       UUID NOT NULL REFERENCES acct_chart_of_accounts(id),
  debit            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (journal_entry_id, line_no),
  CHECK (NOT (debit > 0 AND credit > 0)),   -- a line is either a debit or a credit, never both
  CHECK (debit > 0 OR credit > 0)           -- a line must move money one way
);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entry_lines_entry   ON acct_journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entry_lines_account ON acct_journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entry_lines_company ON acct_journal_entry_lines(company_id);

-- Enforcement: line.company_id must match its parent entry's company_id
CREATE OR REPLACE FUNCTION acct_check_line_company_match() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id != (SELECT company_id FROM acct_journal_entries WHERE id = NEW.journal_entry_id) THEN
    RAISE EXCEPTION 'acct_journal_entry_lines.company_id must match parent journal entry company_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_journal_entry_lines_company_match ON acct_journal_entry_lines;
CREATE TRIGGER trg_acct_journal_entry_lines_company_match
  BEFORE INSERT OR UPDATE ON acct_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION acct_check_line_company_match();

-- Enforcement: entry must balance (debits = credits) before it may be posted
CREATE OR REPLACE FUNCTION acct_check_entry_balances_on_post() RETURNS TRIGGER AS $$
DECLARE
  total_debit  NUMERIC(14,2);
  total_credit NUMERIC(14,2);
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO total_debit, total_credit
      FROM acct_journal_entry_lines WHERE journal_entry_id = NEW.id;
    IF total_debit = 0 AND total_credit = 0 THEN
      RAISE EXCEPTION 'Cannot post journal entry %: has no lines', NEW.entry_no;
    END IF;
    IF total_debit != total_credit THEN
      RAISE EXCEPTION 'Cannot post journal entry %: debits (%) != credits (%)', NEW.entry_no, total_debit, total_credit;
    END IF;
    NEW.posted_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_journal_entries_balance_check ON acct_journal_entries;
CREATE TRIGGER trg_acct_journal_entries_balance_check
  BEFORE UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_check_entry_balances_on_post();

-- Enforcement: posted/void entries are immutable (only draft may be edited/deleted)
CREATE OR REPLACE FUNCTION acct_prevent_posted_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'void') THEN
      RAISE EXCEPTION 'Cannot delete a % journal entry (%)', OLD.status, OLD.entry_no;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Cannot modify a void journal entry (%)', OLD.entry_no;
  END IF;
  IF OLD.status = 'posted' AND NOT (NEW.status = 'void' AND NEW.entry_no = OLD.entry_no AND NEW.entry_date = OLD.entry_date) THEN
    RAISE EXCEPTION 'Cannot modify a posted journal entry (%) except to void it', OLD.entry_no;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_journal_entries_immutability ON acct_journal_entries;
CREATE TRIGGER trg_acct_journal_entries_immutability
  BEFORE UPDATE OR DELETE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_posted_mutation();

CREATE OR REPLACE FUNCTION acct_prevent_posted_line_mutation() RETURNS TRIGGER AS $$
DECLARE
  entry_status TEXT;
BEGIN
  SELECT status INTO entry_status FROM acct_journal_entries
    WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF entry_status IN ('posted', 'void') THEN
    RAISE EXCEPTION 'Cannot modify lines of a % journal entry', entry_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_journal_entry_lines_immutability ON acct_journal_entry_lines;
CREATE TRIGGER trg_acct_journal_entry_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON acct_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_posted_line_mutation();

-- Enforcement: no entry may be created/dated into a locked fiscal period
CREATE OR REPLACE FUNCTION acct_check_period_not_locked() RETURNS TRIGGER AS $$
DECLARE
  is_locked BOOLEAN;
BEGIN
  SELECT (locked_at IS NOT NULL) INTO is_locked
    FROM acct_fiscal_periods
    WHERE company_id = NEW.company_id AND NEW.entry_date BETWEEN period_start AND period_end
    LIMIT 1;
  IF is_locked THEN
    RAISE EXCEPTION 'Cannot post/edit journal entry dated %: fiscal period is locked', NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_journal_entries_period_lock ON acct_journal_entries;
CREATE TRIGGER trg_acct_journal_entries_period_lock
  BEFORE INSERT OR UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_check_period_not_locked();

-- Fiscal periods cannot be unlocked through the application once locked
CREATE OR REPLACE FUNCTION acct_prevent_unlock() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NULL THEN
    RAISE EXCEPTION 'Fiscal periods cannot be unlocked through the application';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acct_fiscal_periods_no_unlock ON acct_fiscal_periods;
CREATE TRIGGER trg_acct_fiscal_periods_no_unlock
  BEFORE UPDATE ON acct_fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_unlock();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Vendor bills (AP)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acct_bills (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_name            TEXT NOT NULL,     -- free text; no acct_vendors master table yet, add later if needed
  bill_no                TEXT,              -- vendor's own bill number, not CBOP-generated
  bill_date              DATE NOT NULL,
  due_date               DATE,
  amount                 NUMERIC(14,2) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  journal_entry_id       UUID REFERENCES acct_journal_entries(id),  -- AP-recognition entry (Dr Expense, Cr Accounts Payable)
  paid_journal_entry_id  UUID REFERENCES acct_journal_entries(id),  -- payment entry (Dr Accounts Payable, Cr Cash/Bank)
  created_by             UUID NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acct_bills_company ON acct_bills(company_id);
CREATE INDEX IF NOT EXISTS idx_acct_bills_status  ON acct_bills(status);

DROP TRIGGER IF EXISTS trg_acct_bills_updated_at ON acct_bills;
CREATE TRIGGER trg_acct_bills_updated_at
  BEFORE UPDATE ON acct_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. GST/TDS metadata — separate from journal lines, linked to source docs
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acct_tax_details (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type              TEXT NOT NULL CHECK (doc_type IN ('invoice', 'bill')),
  doc_id                UUID NOT NULL,   -- polymorphic: sales_invoices.id or acct_bills.id per doc_type, no FK
  journal_entry_line_id UUID REFERENCES acct_journal_entry_lines(id),  -- back-link once posted; nullable until then
  counterparty_gstin    TEXT,
  hsn_sac_code          TEXT,
  taxable_value         NUMERIC(14,2) NOT NULL,
  cgst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  cgst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sgst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  igst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  tds_section           TEXT,          -- e.g. '194C','194J','194Q' - free text, law changes more often than a CHECK should be maintained
  tds_rate              NUMERIC(5,2),
  tds_amount            NUMERIC(14,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (NOT (cgst_amount > 0 AND igst_amount > 0))  -- intra-state and inter-state are mutually exclusive on one line
);
CREATE INDEX IF NOT EXISTS idx_acct_tax_details_company ON acct_tax_details(company_id);
CREATE INDEX IF NOT EXISTS idx_acct_tax_details_doc     ON acct_tax_details(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_acct_tax_details_line    ON acct_tax_details(journal_entry_line_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Row-level audit history for the accounting tables
-- ═══════════════════════════════════════════════════════════════════════════
-- Reuses the platform-wide audit_logs table + cbop_write_audit_log() trigger
-- function shipped in migration 059 (already proven append-only, already
-- reads the same requireAuth-established actor context via
-- runWithActorContext()/transaction() in api/lib/db.ts) instead of a
-- second, accounting-only audit table. One audit design in this codebase,
-- not two — see migration 059's own comment for why.

DROP TRIGGER IF EXISTS trg_acct_chart_of_accounts_audit ON acct_chart_of_accounts;
CREATE TRIGGER trg_acct_chart_of_accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON acct_chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();

DROP TRIGGER IF EXISTS trg_acct_journal_entries_audit ON acct_journal_entries;
CREATE TRIGGER trg_acct_journal_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();

DROP TRIGGER IF EXISTS trg_acct_journal_entry_lines_audit ON acct_journal_entry_lines;
CREATE TRIGGER trg_acct_journal_entry_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON acct_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();

DROP TRIGGER IF EXISTS trg_acct_fiscal_periods_audit ON acct_fiscal_periods;
CREATE TRIGGER trg_acct_fiscal_periods_audit
  AFTER INSERT OR UPDATE OR DELETE ON acct_fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();

DROP TRIGGER IF EXISTS trg_acct_bills_audit ON acct_bills;
CREATE TRIGGER trg_acct_bills_audit
  AFTER INSERT OR UPDATE OR DELETE ON acct_bills
  FOR EACH ROW EXECUTE FUNCTION cbop_write_audit_log();
