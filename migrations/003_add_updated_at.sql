-- Add updated_at to deals and tasks for stale-tracking on the Home dashboard
-- Required for: "deal unchanged for 7+ days" alert in GET /api/dashboard

ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE ops_tasks   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
