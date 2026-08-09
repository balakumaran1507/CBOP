-- 058_app_notifications: in-app notification system
-- idempotent: safe to run multiple times

CREATE TABLE IF NOT EXISTS app_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'system',
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_notifications_user_id_idx ON app_notifications(user_id);
CREATE INDEX IF NOT EXISTS app_notifications_unread_idx ON app_notifications(user_id, read) WHERE read = FALSE;

-- Seed a welcome notification for all existing users
INSERT INTO app_notifications (user_id, type, title, body, link)
SELECT id, 'system', 'Welcome to CBOP', 'Your workspace is set up and ready. Explore the sidebar to get started.', '/dashboard'
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM app_notifications WHERE type = 'system' AND title = 'Welcome to CBOP'
)
ON CONFLICT DO NOTHING;
