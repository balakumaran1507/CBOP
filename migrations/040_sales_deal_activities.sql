-- Per-deal activity timeline (calls/emails/notes/meetings), Pipedrive's core
-- differentiator that CBOP's already-good Kanban board didn't have - deal
-- cards had no history, just current stage.

CREATE TABLE sales_deal_activities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id     UUID REFERENCES sales_deals(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'stage_change')),
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deal_activities_deal ON sales_deal_activities(deal_id, created_at DESC);
