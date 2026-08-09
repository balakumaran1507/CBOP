-- Timeline/Gantt view for Work/Projects - the real Linear/Asana-style gap
-- (Kanban already existed and shows status; Timeline shows *when* work happens
-- and what blocks what). start_date is optional - falls back to created_at
-- in the UI when not set. Single dependency link, not a full DAG - matches
-- how this team actually plans (a handful of blocking relationships, not
-- complex multi-parent dependency graphs).

ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS depends_on_task_id UUID REFERENCES ops_tasks(id) ON DELETE SET NULL;
