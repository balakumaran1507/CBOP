-- Auto-maintain updated_at on sales_deals and ops_tasks.
-- Without this, every UPDATE must manually set updated_at = NOW() or the
-- stale-deal alert on the Home dashboard silently returns wrong data.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_deals_updated_at
  BEFORE UPDATE ON sales_deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ops_tasks_updated_at
  BEFORE UPDATE ON ops_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
