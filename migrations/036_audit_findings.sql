-- Persisted audit findings, replacing the old "recompute and throw away every
-- chat message" pattern. A scan run inserts new findings; nothing is
-- auto-resolved - the user marks findings dismissed/resolved by hand so the
-- record stays an honest trail of what was actually reviewed.

CREATE TABLE audit_findings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('duplicate_expense', 'category_spike', 'overdue_invoice', 'negative_margin')),
  severity      TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  detail        TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL,
  detected_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  UNIQUE (company_id, type, dedupe_key)
);

CREATE INDEX idx_audit_findings_company ON audit_findings(company_id);
CREATE INDEX idx_audit_findings_status ON audit_findings(status);
CREATE INDEX idx_audit_findings_detected ON audit_findings(detected_at);
