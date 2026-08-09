-- Creator role: a super-admin tier above CEO.
-- CEO stays company-scoped via user_companies (so a future per-company CEO-tier
-- account only sees their assigned companies). Creator always sees all companies
-- and bypasses every requireRole gate — see api/middleware/require-role.ts.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('creator', 'ceo', 'coo', 'cto'));

UPDATE users SET role = 'creator' WHERE email = 'founders@cybercomctf.com';
