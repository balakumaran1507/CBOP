-- 019 — Per-domain sending caps (warm-up tiers) + root-cause fix for the
-- 2026-06-16 zapsters.in lockout.
--
-- What happened: zapsters.in is a brand-new Google Workspace mailbox. CBOP's
-- only safety valve was a single flat DAILY_CAP = 1000 (mailer.ts), which is
-- a sane ceiling for an aged, reputable Workspace account but wildly too high
-- for a domain with zero sending history. We pushed ~900 campaign sends
-- through it in one day; Google's abuse heuristics flagged the account and
-- locked it ("534-5.7.9 WebLoginRequired") — this is a security lockout, not
-- a quota bounce, and it doesn't clear on its own until a human completes a
-- browser login + verification on that mailbox.
--
-- Fix: caps are now per-domain and default conservative. New/unproven
-- domains start low; raise `daily_cap` by hand in this table as a domain
-- builds send history and a clean bounce/complaint record (classic ESP
-- warm-up: roughly double the cap every 3-5 days of clean sending).

ALTER TABLE email_domains ADD COLUMN IF NOT EXISTS daily_cap INTEGER NOT NULL DEFAULT 50;

-- zapsters.in: locked out after a 900+/day burst on a brand-new mailbox.
-- Drop hard until the account is unlocked, then keep it on a slow ramp.
UPDATE email_domains SET daily_cap = 30  WHERE domain = 'zapsters.in';

-- cybercomctf.com / ouantum.com: same "new Workspace" risk profile, no send
-- history to justify anything higher yet. Keep them on the conservative
-- default explicitly so a future change to DEFAULT doesn't silently raise them.
UPDATE email_domains SET daily_cap = 50  WHERE domain IN ('cybercomctf.com', 'ouantum.com');
