-- better-auth 0.8.8 -> 1.6.25 migration.
--
-- better-auth 1.x decouples the session's public bearer token from its
-- internal row id: the `session` table now requires a `token` column
-- (type text, NOT NULL, UNIQUE) distinct from `id`. In 0.8.8 the row `id`
-- itself was the value stored in the session cookie, so there was no
-- separate token column (see migrations/002_auth_tables.sql).
--
-- Without this column, better-auth 1.x's createSession() INSERT fails
-- with `column "token" of relation "session" does not exist` on every
-- login (magic-link verify, password sign-in) — this is not optional.
--
-- Backfill: existing rows get token = id. This is safe and not a security
-- downgrade — it exactly reproduces 0.8.8's behavior where id was already
-- serving as the bearer token, so any still-valid pre-migration session
-- cookie continues to authenticate correctly post-migration.

ALTER TABLE session ADD COLUMN IF NOT EXISTS token TEXT;

UPDATE session SET token = id WHERE token IS NULL;

ALTER TABLE session ALTER COLUMN token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token ON session(token);
