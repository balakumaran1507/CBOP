ALTER TABLE rnd_initiatives
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'ideation'
    CHECK (phase IN ('ideation','exploration','development','analysis','documentation','publication')),
  ADD COLUMN IF NOT EXISTS hypothesis TEXT,
  ADD COLUMN IF NOT EXISTS problem_statement TEXT,
  ADD COLUMN IF NOT EXISTS budget_estimate NUMERIC;

CREATE TABLE IF NOT EXISTS rnd_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID NOT NULL REFERENCES rnd_initiatives(id) ON DELETE CASCADE,
  phase          TEXT NOT NULL CHECK (phase IN ('ideation','exploration','development','analysis','documentation','publication')),
  title          TEXT NOT NULL,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','blocked')),
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rnd_resources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID NOT NULL REFERENCES rnd_initiatives(id) ON DELETE CASCADE,
  resource_type  TEXT NOT NULL CHECK (resource_type IN ('budget','api','hardware','software','human','other')),
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'needed' CHECK (status IN ('needed','requested','approved','available','rejected')),
  estimated_cost NUMERIC,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rnd_references (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID NOT NULL REFERENCES rnd_initiatives(id) ON DELETE CASCADE,
  ref_type       TEXT NOT NULL CHECK (ref_type IN ('paper','code','dataset','tool','competitor','related_work','inspiration','standard')),
  title          TEXT NOT NULL,
  url            TEXT,
  notes          TEXT,
  is_pinned      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rnd_publications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID NOT NULL REFERENCES rnd_initiatives(id) ON DELETE CASCADE,
  pub_type       TEXT NOT NULL CHECK (pub_type IN ('ieee_paper','conference','blog_post','linkedin','internal_report','patent','whitepaper','demo')),
  status         TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','drafting','review','submitted','published','rejected')),
  target_venue   TEXT,
  target_date    DATE,
  checklist      JSONB NOT NULL DEFAULT '[]',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
