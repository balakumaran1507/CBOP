-- Mentor Council: split the CA persona back into distinct, separate advisors
-- per explicit user direction (no bundling). Nine personas total:
-- ca, mba, marketing_advisor, tech_consultant, legal (existing) +
-- accountant, tax_saving, itr_filing, auditor (new).

ALTER TABLE mentor_conversations DROP CONSTRAINT mentor_conversations_persona_check;
ALTER TABLE mentor_conversations ADD CONSTRAINT mentor_conversations_persona_check
  CHECK (persona IN ('ca', 'mba', 'marketing_advisor', 'tech_consultant', 'legal', 'accountant', 'tax_saving', 'itr_filing', 'auditor'));
