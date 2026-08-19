-- Morning briefing schedule + per-recipient content config

CREATE TABLE morning_briefing_config (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  send_time    TEXT        NOT NULL DEFAULT '08:00',        -- HH:MM (24h)
  active_days  INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=Sun 1=Mon…6=Sat
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one row
INSERT INTO morning_briefing_config (send_time, active_days, is_active)
VALUES ('08:00', '{1,2,3,4,5}', true);

CREATE TABLE morning_briefing_recipients (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  channel              TEXT        NOT NULL DEFAULT 'telegram', -- 'telegram'|'whatsapp'
  include_tasks        BOOLEAN     NOT NULL DEFAULT TRUE,
  include_invoices     BOOLEAN     NOT NULL DEFAULT TRUE,
  include_deals        BOOLEAN     NOT NULL DEFAULT TRUE,
  include_automations  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);
