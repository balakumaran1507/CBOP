-- Financial Models tab: one editable assumption set per company, driving a
-- computed base/optimistic/conservative projection (deterministic math server-side,
-- no LLM involved - this is arithmetic, not narrative).

CREATE TABLE finance_scenarios (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                  UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  starting_revenue            NUMERIC(14,2) NOT NULL DEFAULT 0,
  starting_expenses           NUMERIC(14,2) NOT NULL DEFAULT 0,
  starting_cash               NUMERIC(14,2) NOT NULL DEFAULT 0,
  monthly_revenue_growth_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
  monthly_expense_growth_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
  horizon_months              INT NOT NULL DEFAULT 12,
  one_time_items              JSONB NOT NULL DEFAULT '[]',
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);
