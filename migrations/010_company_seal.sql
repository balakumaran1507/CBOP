-- Migration 010: Ensure company_seal column exists on companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_seal TEXT;
