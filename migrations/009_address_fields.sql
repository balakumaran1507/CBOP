-- Migration 009: Ensure address fields exist on companies and clients
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE sales_clients ADD COLUMN IF NOT EXISTS address TEXT;
