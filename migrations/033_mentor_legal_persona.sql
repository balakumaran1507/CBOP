-- Mentor Council: add 'legal' persona. 'ca' persona's scope also now
-- explicitly covers tax saving, ITR filing, and audit prep (prompt-level
-- change in api/routes/mentor.ts, no schema change needed for that part).

ALTER TABLE mentor_conversations DROP CONSTRAINT mentor_conversations_persona_check;
ALTER TABLE mentor_conversations ADD CONSTRAINT mentor_conversations_persona_check
  CHECK (persona IN ('ca', 'mba', 'marketing_advisor', 'tech_consultant', 'legal'));
