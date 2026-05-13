-- CBOP v2 Initial Database Schema
-- All tables, constraints, and indexes

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ceo', 'coo', 'cto')),
  telegram_chat_id TEXT,
  whatsapp_number TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT,
  invoice_prefix TEXT NOT NULL UNIQUE,
  gstin TEXT,
  upi_id TEXT,
  bank_details JSONB,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_owner ON companies(owner_id);

-- User-Company relationships
CREATE TABLE user_companies (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE INDEX idx_user_companies_user ON user_companies(user_id);
CREATE INDEX idx_user_companies_company ON user_companies(company_id);

-- ============================================================================
-- SALES TABLES
-- ============================================================================

-- Leads
CREATE TABLE sales_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  org_name TEXT,
  source TEXT CHECK (source IN ('inbound', 'outbound', 'referral', 'event')),
  score INT DEFAULT 0,
  badge TEXT CHECK (badge IN ('hot', 'warm', 'cold')),
  status TEXT DEFAULT 'new',
  owner_id UUID REFERENCES users(id),
  last_contact_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_leads_company ON sales_leads(company_id);
CREATE INDEX idx_sales_leads_owner ON sales_leads(owner_id);
CREATE INDEX idx_sales_leads_status ON sales_leads(status);
CREATE INDEX idx_sales_leads_score ON sales_leads(score DESC);

-- Clients
CREATE TABLE sales_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  org_name TEXT,
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_clients_company ON sales_clients(company_id);
CREATE INDEX idx_sales_clients_added_by ON sales_clients(added_by);

-- Deals
CREATE TABLE sales_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES sales_leads(id),
  client_id UUID REFERENCES sales_clients(id),
  name TEXT NOT NULL,
  value NUMERIC(12,2),
  stage TEXT CHECK (stage IN ('lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost')),
  service_type TEXT CHECK (service_type IN ('cybersecurity_event', 'penetration_test', 'it_consulting', 'game_development', 'other')),
  owner_id UUID REFERENCES users(id),
  lost_reason TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_deals_company ON sales_deals(company_id);
CREATE INDEX idx_sales_deals_owner ON sales_deals(owner_id);
CREATE INDEX idx_sales_deals_stage ON sales_deals(stage);
CREATE INDEX idx_sales_deals_client ON sales_deals(client_id);

-- Invoices
CREATE TABLE sales_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES sales_deals(id),
  client_id UUID REFERENCES sales_clients(id) ON DELETE CASCADE,
  invoice_no TEXT UNIQUE NOT NULL,
  amount NUMERIC(12,2),
  gst_type TEXT CHECK (gst_type IN ('cgst_sgst', 'igst')),
  gst_amount NUMERIC(12,2),
  total NUMERIC(12,2),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  pdf_url TEXT,
  status TEXT CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_invoices_company ON sales_invoices(company_id);
CREATE INDEX idx_sales_invoices_client ON sales_invoices(client_id);
CREATE INDEX idx_sales_invoices_status ON sales_invoices(status);
CREATE INDEX idx_sales_invoices_due_date ON sales_invoices(due_date);
CREATE INDEX idx_sales_invoices_invoice_no ON sales_invoices(invoice_no);

-- ============================================================================
-- OPERATIONS TABLES
-- ============================================================================

-- Projects
CREATE TABLE ops_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_id UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
  deadline DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ops_projects_company ON ops_projects(company_id);
CREATE INDEX idx_ops_projects_owner ON ops_projects(owner_id);
CREATE INDEX idx_ops_projects_status ON ops_projects(status);

-- Tasks
CREATE TABLE ops_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES ops_projects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  owner_id UUID REFERENCES users(id),
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  due_date DATE,
  linked_deal_id UUID REFERENCES sales_deals(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ops_tasks_company ON ops_tasks(company_id);
CREATE INDEX idx_ops_tasks_project ON ops_tasks(project_id);
CREATE INDEX idx_ops_tasks_owner ON ops_tasks(owner_id);
CREATE INDEX idx_ops_tasks_status ON ops_tasks(status);
CREATE INDEX idx_ops_tasks_due_date ON ops_tasks(due_date);

-- Work Sessions
CREATE TABLE ops_work_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES ops_projects(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  output TEXT,
  attendees JSONB,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ops_work_sessions_company ON ops_work_sessions(company_id);
CREATE INDEX idx_ops_work_sessions_project ON ops_work_sessions(project_id);

-- Task Templates (for SOP-based task creation)
CREATE TABLE ops_task_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_type TEXT NOT NULL,
  task_title TEXT NOT NULL,
  default_owner_role TEXT,
  days_offset INT,
  sop_doc_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ops_task_templates_service ON ops_task_templates(service_type);

-- ============================================================================
-- MARKETING TABLES
-- ============================================================================

-- Campaigns
CREATE TABLE marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  status TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_marketing_campaigns_company ON marketing_campaigns(company_id);

-- Social Posts
CREATE TABLE marketing_social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES marketing_campaigns(id),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  content TEXT,
  platform TEXT CHECK (platform IN ('linkedin', 'instagram', 'twitter')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('draft', 'scheduled', 'posted', 'failed'))
);

CREATE INDEX idx_marketing_social_posts_company ON marketing_social_posts(company_id);
CREATE INDEX idx_marketing_social_posts_campaign ON marketing_social_posts(campaign_id);
CREATE INDEX idx_marketing_social_posts_status ON marketing_social_posts(status);

-- ============================================================================
-- FINANCE TABLES (CEO-only access)
-- ============================================================================

-- Monthly P&L
CREATE TABLE finance_monthly_pl (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  revenue NUMERIC(14,2),
  expenses NUMERIC(14,2),
  profit NUMERIC(14,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, month)
);

CREATE INDEX idx_finance_monthly_pl_company ON finance_monthly_pl(company_id);
CREATE INDEX idx_finance_monthly_pl_month ON finance_monthly_pl(month);

-- Expenses
CREATE TABLE finance_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT,
  amount NUMERIC(12,2),
  description TEXT,
  date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_finance_expenses_company ON finance_expenses(company_id);
CREATE INDEX idx_finance_expenses_date ON finance_expenses(date);

-- Holdings (equity stakes)
CREATE TABLE finance_holdings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT,
  equity_pct NUMERIC(5,2),
  valuation NUMERIC(14,2),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personal Wealth (CEO-only, never in agent context)
CREATE TABLE finance_personal_wealth (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_date DATE NOT NULL UNIQUE,
  net_worth NUMERIC(14,2),
  cash NUMERIC(14,2),
  equity_stakes NUMERIC(14,2),
  other_assets NUMERIC(14,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_finance_personal_wealth_date ON finance_personal_wealth(snapshot_date);

-- ============================================================================
-- TEMPLATES
-- ============================================================================

-- Document Templates
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('invoice', 'proposal', 'contract', 'nda', 'mou', 'email', 'onboarding')),
  content TEXT,
  variables JSONB,
  version INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_company ON templates(company_id);
CREATE INDEX idx_templates_type ON templates(type);

-- Template Versions (keep last 5)
CREATE TABLE templates_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
  content TEXT,
  version INT,
  saved_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_versions_template ON templates_versions(template_id);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

-- System Jobs (automations + agents)
CREATE TABLE system_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('automation', 'agent')),
  status TEXT CHECK (status IN ('pending', 'running', 'done', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payload JSONB,
  result JSONB,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_jobs_name ON system_jobs(name);
CREATE INDEX idx_system_jobs_status ON system_jobs(status);
CREATE INDEX idx_system_jobs_created ON system_jobs(created_at DESC);

-- Notifications Sent Log
CREATE TABLE notifications_sent (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  channel TEXT CHECK (channel IN ('telegram', 'whatsapp', 'email')),
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_sent_user ON notifications_sent(user_id);
CREATE INDEX idx_notifications_sent_sent_at ON notifications_sent(sent_at DESC);

-- Audit Logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  company_id UUID REFERENCES companies(id),
  table_name TEXT,
  action TEXT CHECK (action IN ('insert', 'update', 'delete')),
  old_val JSONB,
  new_val JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_company ON audit_logs(company_id);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================================
-- INITIAL SEED DATA
-- ============================================================================

-- Insert companies
INSERT INTO companies (id, name, type, invoice_prefix, owner_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Etherence IT', 'it', 'ETH', NULL),
  ('22222222-2222-2222-2222-222222222222', 'Etherence Pentest', 'security', 'PEN', NULL),
  ('33333333-3333-3333-3333-333333333333', 'CYBERCOM CTF', 'ctf', 'CYB', NULL),
  ('44444444-4444-4444-4444-444444444444', 'AttackOS', 'gamedev', 'ATK', NULL);

-- Insert default users (passwords will be set via better-auth)
-- User IDs are placeholders - will be created properly in Slice 1
-- User-company mappings will be added in Slice 1

COMMIT;
