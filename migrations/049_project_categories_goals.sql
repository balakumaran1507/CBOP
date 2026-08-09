ALTER TABLE ops_projects
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'client'
    CHECK (category IN ('client', 'product', 'ops', 'rnd')),
  ADD COLUMN IF NOT EXISTS health TEXT NOT NULL DEFAULT 'on_track'
    CHECK (health IN ('on_track', 'at_risk', 'blocked'));

UPDATE ops_projects SET category = 'ops' WHERE work_type = 'internal';

CREATE TABLE IF NOT EXISTS quarterly_goals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year       INT NOT NULL,
  quarter    INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  objective  TEXT NOT NULL,
  owner_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quarterly_key_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID NOT NULL REFERENCES quarterly_goals(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  target_value  NUMERIC,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goal_projects (
  goal_id    UUID NOT NULL REFERENCES quarterly_goals(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES ops_projects(id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, project_id)
);
