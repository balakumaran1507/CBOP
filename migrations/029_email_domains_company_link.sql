-- Migration 029: link each email_domains row to its owning company.
-- Never populated since migration 014 seeded these rows — meaning any code
-- path that wants "the right From address for company X" (Email Studio's
-- sendDesignEmail, notably) had no way to resolve it and silently fell back
-- to the generic CBOP_PLATFORM/SMTP_FROM sender regardless of which company
-- the email was actually for. Confirmed live: the Ouantum-Workshop-Cert batch
-- sent all 132+ certificates from founders@cybercomctf.com instead of
-- founders@ouantum.com.

UPDATE email_domains SET company_id = c.id
FROM companies c
WHERE email_domains.domain = 'ouantum.com'     AND c.name = 'Ouantum';

UPDATE email_domains SET company_id = c.id
FROM companies c
WHERE email_domains.domain = 'zapsters.in'     AND c.name = 'Zapsters';

UPDATE email_domains SET company_id = c.id
FROM companies c
WHERE email_domains.domain = 'cybercomctf.com' AND c.name = 'CYBERCOM CTF';

UPDATE email_domains SET company_id = c.id
FROM companies c
WHERE email_domains.domain = 'attackos.com'    AND c.name = 'AttackOS';

-- etherence.com is shared by both Etherence entities in practice — link it to
-- Etherence IT as the primary; it's unverified today so this doesn't affect
-- any real send until Workspace is set up (see docs/EMAIL_DELIVERABILITY.md).
UPDATE email_domains SET company_id = c.id
FROM companies c
WHERE email_domains.domain = 'etherence.com'   AND c.name = 'Etherence IT';
