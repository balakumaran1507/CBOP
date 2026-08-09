import { writeFile, unlink } from 'fs/promises'
import { Hono } from 'hono'
import { query, runWithActorContext } from '../lib/db'
import { AUDIT_ACTIONS, getClientIp, writeAuditLog } from '../lib/audit-log'
import { buildInvoicePdf } from '../lib/pdf-generator'
import { sendViaOpenClaw, triggerAgent } from '../lib/openclaw'
import { getConnection, getValidAccessToken } from '../lib/seo-tokens'
import { getSearchAnalytics } from '../lib/google-search-console'
import type { SearchAnalyticsRow } from '../lib/google-search-console'

const app = new Hono()

const MCP_TOKEN = process.env.CBOP_MCP_TOKEN || ''

// ── Caller resolution ─────────────────────────────────────────────────────────

interface CallerUser {
  id: string
  role: string
  companyIds: string[]
}

async function resolveCallerUser(telegramId: string): Promise<CallerUser | null> {
  const result = await query(
    `SELECT u.id, u.role,
            array_agg(DISTINCT uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) AS company_ids
     FROM users u
     LEFT JOIN user_companies uc ON uc.user_id = u.id
     WHERE u.telegram_chat_id = $1 AND u.is_active = true
     GROUP BY u.id`,
    [telegramId]
  )
  if (!result.rows.length) return null
  const row = result.rows[0]

  // Creator is a super-admin tier - always sees every company, regardless of
  // its own user_companies assignment.
  if (row.role === 'creator') {
    const allCompanies = await query(`SELECT id FROM companies`, [])
    return { id: row.id as string, role: row.role as string, companyIds: allCompanies.rows.map(r => r.id) }
  }

  return { id: row.id as string, role: row.role as string, companyIds: (row.company_ids as string[]) || [] }
}

// Returns user.companyIds filtered to company_id if provided (empty = not in scope)
function scopedIds(user: CallerUser, companyId?: string): string[] {
  if (!companyId) return user.companyIds
  if (!user.companyIds.includes(companyId)) return []
  return [companyId]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Accepts a UUID or an invoice_no (e.g. CYB-2026-0002) and returns the UUID, or null if not found.
async function resolveInvoiceId(input: string): Promise<string | null> {
  if (UUID_RE.test(input)) return input
  const res = await query(
    `SELECT id FROM sales_invoices WHERE invoice_no = $1 LIMIT 1`,
    [input]
  )
  if (!res.rows.length) return null
  return res.rows[0].id as string
}

async function generateInvoiceNumber(companyId: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear()
  const like = `${prefix}-${year}-%`
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_no, '-', 3) AS INTEGER)), 0) AS max_seq
     FROM sales_invoices WHERE company_id = $1 AND invoice_no LIKE $2`,
    [companyId, like]
  )
  const next = ((result.rows[0]?.max_seq as number) + 1).toString().padStart(4, '0')
  return `${prefix}-${year}-${next}`
}

async function fireN8nWebhook(path: string, body: Record<string, unknown>): Promise<void> {
  const n8nUrl = process.env.N8N_URL
  if (!n8nUrl) return
  try {
    await Promise.race([
      fetch(`${n8nUrl}/webhook/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_WEBHOOK_SECRET ? { 'x-n8n-secret': process.env.N8N_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify(body),
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])
  } catch { /* n8n optional */ }
}

// ── Month range parser ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
]

function parseMonthRange(input: string): { start: string; end: string } | null {
  const s = input.toLowerCase().trim()
  const now = new Date()

  if (s === 'this month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (s === 'last month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end   = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const idx = MONTH_NAMES.indexOf(s)
  if (idx === -1) return null

  // Use current year; if the month is in the future, roll back to previous year
  let year = now.getFullYear()
  if (idx > now.getMonth()) year -= 1

  const start = new Date(year, idx, 1)
  const end   = new Date(year, idx + 1, 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: 'cbop_get_dashboard',
    description: 'Dashboard summary: revenue this month, open deals, overdue invoice count, tasks due today, cash position (CEO only), last 10 system jobs',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string', description: 'Telegram chat ID of the caller' },
        company_id: { type: 'string', description: 'Filter to a specific company (optional)' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_pipeline',
    description: 'Sales pipeline deals grouped by stage with value totals. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_overdue_invoices',
    description: 'All overdue invoices with client name, amount, and days overdue. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_create_invoice',
    description: 'Create a new draft invoice for a client. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        client_id:           { type: 'string' },
        amount:              { type: 'number', description: 'Pre-tax amount in INR' },
        service_description: { type: 'string' },
        gst_type:            { type: 'string', enum: ['igst', 'cgst_sgst', 'none'] },
        due_date:            { type: 'string', description: 'ISO date YYYY-MM-DD' },
        company_id:          { type: 'string' },
        notes:               { type: 'string' },
        po_number:           { type: 'string' },
        hsn_code:            { type: 'string', description: 'Default: 998314' },
      },
      required: ['caller_telegram_id', 'client_id', 'amount', 'service_description', 'gst_type', 'due_date', 'company_id'],
    },
  },
  {
    name: 'cbop_send_invoice',
    description: 'Generate invoice PDF and send to client via WhatsApp. Updates status to sent. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        invoice_id:         { type: 'string' },
      },
      required: ['caller_telegram_id', 'invoice_id'],
    },
  },
  {
    name: 'cbop_create_deal',
    description: 'Create a new sales deal. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        name:         { type: 'string' },
        value:        { type: 'number' },
        service_type: { type: 'string' },
        company_id:   { type: 'string' },
        client_id:    { type: 'string' },
        stage:        { type: 'string', enum: ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] },
        owner_id:     { type: 'string' },
      },
      required: ['caller_telegram_id', 'name', 'company_id'],
    },
  },
  {
    name: 'cbop_move_deal',
    description: 'Move a deal to a new pipeline stage. lost_reason required for closed_lost. Fires deal_invoice_tasks agent on closed_won. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        deal_id:     { type: 'string' },
        stage:       { type: 'string', enum: ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] },
        lost_reason: { type: 'string', description: 'Required when stage is closed_lost' },
      },
      required: ['caller_telegram_id', 'deal_id', 'stage'],
    },
  },
  {
    name: 'cbop_create_task',
    description: 'Create a task. project_id is mandatory - every task must belong to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        title:      { type: 'string' },
        project_id: { type: 'string' },
        owner_id:   { type: 'string' },
        due_date:   { type: 'string', description: 'ISO date YYYY-MM-DD' },
        priority:   { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        company_id: { type: 'string' },
      },
      required: ['caller_telegram_id', 'title', 'project_id'],
    },
  },
  {
    name: 'cbop_complete_task',
    description: 'Mark a task as done.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        task_id: { type: 'string' },
      },
      required: ['caller_telegram_id', 'task_id'],
    },
  },
  {
    name: 'cbop_get_tasks',
    description: 'Get tasks with project name, owner, and due date.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        user_id:    { type: 'string', description: 'Filter by owner (CEO/COO only - others see their own)' },
        company_id: { type: 'string' },
        status:     { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_clients',
    description: 'Get clients with deal count and total billed. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_create_lead',
    description: 'Create a new sales lead. Fires n8n lead_scoring webhook. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        name:       { type: 'string' },
        org:        { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        source:     { type: 'string', enum: ['inbound', 'outbound', 'referral', 'event', 'other'] },
        owner_id:   { type: 'string' },
        company_id: { type: 'string' },
      },
      required: ['caller_telegram_id', 'name', 'company_id'],
    },
  },
  {
    name: 'cbop_convert_lead',
    description: 'Convert a lead to a deal. Creates client record if needed. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        lead_id:      { type: 'string' },
        deal_name:    { type: 'string' },
        deal_value:   { type: 'number' },
        service_type: { type: 'string' },
      },
      required: ['caller_telegram_id', 'lead_id'],
    },
  },
  {
    name: 'cbop_send_invoice_reminder',
    description: 'Send payment reminder for an invoice. Default: WhatsApp to client phone. With channel=whatsapp and to=GROUP_JID: sends to that group. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        invoice_id:         { type: 'string' },
        channel:            { type: 'string', enum: ['whatsapp'], description: 'Delivery channel (optional, defaults to whatsapp to client phone)' },
        to:                 { type: 'string', description: 'Override destination - WhatsApp group JID or phone (optional, defaults to client phone)' },
      },
      required: ['caller_telegram_id', 'invoice_id'],
    },
  },
  {
    name: 'cbop_get_system_health',
    description: 'Last 10 system jobs with name, status, completed_at, and error_message.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_morning_briefing',
    description: 'Full morning briefing data to format: overdue invoices, open deals, pipeline value, tasks due today, stale deals, recent automations, cash positions (CEO only).',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        user_id: { type: 'string', description: 'Whose tasks to pull (defaults to caller)' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_create_project',
    description: 'Create a new project.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        name:        { type: 'string' },
        company_id:  { type: 'string' },
        owner_id:    { type: 'string' },
        deadline:    { type: 'string', description: 'ISO date YYYY-MM-DD' },
        description: { type: 'string' },
      },
      required: ['caller_telegram_id', 'name', 'company_id'],
    },
  },
  {
    name: 'cbop_update_lead',
    description: 'Update lead fields: notes, score, status, last_contact_at. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        lead_id:         { type: 'string' },
        notes:           { type: 'string' },
        score:           { type: 'number', description: '0–100' },
        status:          { type: 'string' },
        last_contact_at: { type: 'string', description: 'ISO datetime' },
      },
      required: ['caller_telegram_id', 'lead_id'],
    },
  },
  {
    name: 'cbop_create_social_post',
    description: 'Create a draft social media post.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        content:      { type: 'string' },
        platform:     { type: 'string', enum: ['linkedin', 'instagram', 'twitter'] },
        company_id:   { type: 'string' },
        scheduled_at: { type: 'string', description: 'ISO datetime (optional - creates as draft if omitted)' },
      },
      required: ['caller_telegram_id', 'content', 'platform', 'company_id'],
    },
  },
  {
    name: 'cbop_send_pdf',
    description: 'Generate an invoice PDF and send it via Telegram or WhatsApp. Use channel=telegram (default) to send to a Telegram chat, channel=whatsapp to send to a WhatsApp group JID. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string', description: 'Telegram chat ID of the caller (for auth)' },
        invoice_id:         { type: 'string', description: 'UUID or invoice_no (e.g. CYB-2026-0002)' },
        channel:            { type: 'string', enum: ['telegram', 'whatsapp'], description: 'Delivery channel (default: telegram)' },
        to:                 { type: 'string', description: 'Target chat_id for telegram, or group JID / phone for whatsapp. Defaults to caller_telegram_id when channel=telegram.' },
      },
      required: ['caller_telegram_id', 'invoice_id'],
    },
  },
  {
    name: 'cbop_send_pdf_to_telegram',
    description: 'Alias for cbop_send_pdf with channel=telegram. Prefer cbop_send_pdf for new callers.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string', description: 'Telegram chat ID of the caller' },
        invoice_id:         { type: 'string' },
        chat_id:            { type: 'string', description: 'Target Telegram chat ID (defaults to caller_telegram_id)' },
      },
      required: ['caller_telegram_id', 'invoice_id'],
    },
  },
  {
    name: 'cbop_get_projects',
    description: 'List projects with company, owner, status, deadline, and task count. All roles, filtered by companyIds.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id:         { type: 'string', description: 'Filter to a specific company (optional)' },
        owner_id:           { type: 'string', description: 'Filter by project owner (optional)' },
        status:             { type: 'string', enum: ['active', 'on_hold', 'completed', 'cancelled'], description: 'Filter by status (optional)' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_team',
    description: 'List all team members with their role, open task count, and active project count. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_search_invoices',
    description: 'Find invoices using natural language references - by client name, approximate amount, month, description keywords, or status. Useful when the caller does not know the invoice number. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        client_name:        { type: 'string', description: 'Partial match on client name or org name' },
        amount:             { type: 'number', description: 'Approximate amount - matches ±20%' },
        month:              { type: 'string', description: '"may", "april", "last month", "this month"' },
        description:        { type: 'string', description: 'Keywords from service description' },
        status:             { type: 'string', enum: ['draft', 'sent', 'paid', 'overdue'], description: 'Invoice status filter' },
      },
      required: ['caller_telegram_id'],
    },
  },

  // ── Hiring tools ────────────────────────────────────────────────────────────
  {
    name: 'cbop_get_hiring_summary',
    description: "Today's hiring status: pending review count, shortlisted, interviews today, offers awaiting response. CEO/COO only.",
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_get_applicants',
    description: 'List applicants with AI scores and summaries. CEO/COO only (CTO sees technical roles only).',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        stage:  { type: 'string', enum: ['applied','reviewed','shortlisted','interview_scheduled','interview_done','selected','offer_sent','accepted','rejected'], description: 'Filter by stage (optional)' },
        role:   { type: 'string', description: 'Filter by role title (partial match, optional)' },
        limit:  { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_shortlist_applicant',
    description: 'Move an applicant to shortlisted stage. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        applicant_id:       { type: 'string', description: 'UUID of the applicant' },
        notes:              { type: 'string', description: 'Optional review notes' },
      },
      required: ['caller_telegram_id', 'applicant_id'],
    },
  },
  {
    name: 'cbop_reject_applicant',
    description: 'Reject an applicant with a reason. CEO/COO only. send_now=true skips the 48hr queue.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        applicant_id:       { type: 'string' },
        reason:             { type: 'string', description: 'Rejection reason' },
        send_now:           { type: 'boolean', description: 'Send rejection email immediately (default false = 48hr queue)' },
      },
      required: ['caller_telegram_id', 'applicant_id', 'reason'],
    },
  },
  {
    name: 'cbop_get_active_interns',
    description: 'List current active interns with role, company, team lead, and start date. CEO/COO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id:         { type: 'string', description: 'Filter by company (optional)' },
      },
      required: ['caller_telegram_id'],
    },
  },

  // ── Document Studio tools ─────────────────────────────────────────────────
  {
    name: 'cbop_list_document_templates',
    description: 'List all document templates (offer letters, certificates) available in Document Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id:         { type: 'string', description: 'Filter by company (optional)' },
      },
      required: ['caller_telegram_id'],
    },
  },
  {
    name: 'cbop_generate_documents',
    description: 'Trigger bulk PDF generation from a document template. Provide recipient data as an array. Optionally sends PDFs via email.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        template_id:        { type: 'string', description: 'UUID of the document template' },
        batch_name:         { type: 'string', description: 'Label for this batch' },
        recipients:         {
          type: 'array',
          description: 'Array of objects where keys match template tag names (e.g. { "candidate_name": "Alice", "email": "alice@example.com" })',
          items: { type: 'object' },
        },
        send_email:         { type: 'boolean', description: 'Send each PDF to the email field if present (default false)' },
      },
      required: ['caller_telegram_id', 'template_id', 'recipients'],
    },
  },
  {
    name: 'cbop_get_document_batch_status',
    description: 'Check the status of a document generation batch - how many PDFs are done and whether they were emailed.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        batch_id:           { type: 'string', description: 'UUID of the batch returned by cbop_generate_documents' },
      },
      required: ['caller_telegram_id', 'batch_id'],
    },
  },
  {
    name: 'cbop_create_blog_draft',
    description: 'Create a draft blog post for a company. Does not publish - returns a draft the user reviews in CBOP before publishing. CEO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        company_id:  { type: 'string', description: 'Required - which company this post is for' },
        title:       { type: 'string' },
        content:     { type: 'string', description: 'Post body, plain text or simple HTML' },
        excerpt:     { type: 'string' },
        category:    { type: 'string' },
        tags:        { type: 'array', items: { type: 'string' } },
      },
      required: ['caller_telegram_id', 'company_id', 'title', 'content'],
    },
  },
  {
    name: 'cbop_seo_score_draft',
    description: 'Score a draft blog post title/meta description/body against basic on-page SEO heuristics (title length, meta description length, body length, heading presence). Pure scoring - no external API call, no data stored. CEO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        title:            { type: 'string' },
        meta_description: { type: 'string' },
        content:          { type: 'string', description: 'Plain text or HTML body to check' },
      },
      required: ['caller_telegram_id', 'title', 'content'],
    },
  },
  {
    name: 'cbop_seo_query_gaps',
    description: 'Find real Search Console queries for a connected site that get impressions but rank poorly (position > 10) or have a low click-through rate - genuine content-gap signals from actual search data, not guesses. Requires the company to have a connected Search Console property (Settings > SEO Connections) - returns a clear message if not connected. CEO only.',
    inputSchema: {
      type: 'object',
      properties: {
        caller_telegram_id: { type: 'string' },
        connection_id: { type: 'string', description: 'UUID from cbop_get_dashboard or the SEO Connections settings tab' },
        days:          { type: 'number', description: 'Lookback window, default 28' },
      },
      required: ['caller_telegram_id', 'connection_id'],
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, user: CallerUser): Promise<unknown> {
  const ids    = scopedIds(user, args.company_id as string | undefined)
  const isCeo  = user.role === 'ceo' || user.role === 'creator'
  const isSales = ['ceo', 'coo', 'cto', 'creator'].includes(user.role)

  switch (name) {

    // ── cbop_get_dashboard ───────────────────────────────────────────────────
    case 'cbop_get_dashboard': {
      if (ids.length === 0) return { error: 'Company not in scope' }

      const [revenueRes, openDealsRes, overdueRes, tasksRes, jobsRes] = await Promise.all([
        isSales
          ? query(
              `SELECT COALESCE(SUM(total), 0)::numeric AS revenue
               FROM sales_invoices
               WHERE company_id = ANY($1) AND status = 'paid'
                 AND created_at >= DATE_TRUNC('month', NOW())`,
              [ids]
            )
          : Promise.resolve({ rows: [{ revenue: '0' }] }),

        isSales
          ? query(
              `SELECT COUNT(*)::int AS count FROM sales_deals
               WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')`,
              [ids]
            )
          : Promise.resolve({ rows: [{ count: 0 }] }),

        query(
          `SELECT COUNT(*)::int AS count FROM sales_invoices
           WHERE company_id = ANY($1) AND due_date < CURRENT_DATE AND status != 'paid'`,
          [ids]
        ),

        query(
          `SELECT COUNT(*)::int AS count FROM ops_tasks
           WHERE company_id = ANY($1) AND due_date = CURRENT_DATE AND status != 'done'`,
          [ids]
        ),

        query(
          `SELECT id, name, type, status, completed_at, error_message
           FROM system_jobs ORDER BY created_at DESC LIMIT 10`
        ),
      ])

      let cashPosition: number | null = null
      if (isCeo) {
        const cashRes = await query(
          `SELECT COALESCE(SUM(amount), 0)::numeric AS total
           FROM finance_cash_position WHERE company_id = ANY($1)`,
          [ids]
        )
        cashPosition = parseFloat(String(cashRes.rows[0].total))
      }

      return {
        revenue_this_month: isSales ? parseFloat(String(revenueRes.rows[0].revenue)) : null,
        open_deals:         isSales ? (openDealsRes.rows[0].count as number) : null,
        overdue_invoices:   overdueRes.rows[0].count as number,
        tasks_due_today:    tasksRes.rows[0].count as number,
        cash_position:      cashPosition,
        recent_jobs:        jobsRes.rows,
      }
    }

    // ── cbop_get_pipeline ────────────────────────────────────────────────────
    case 'cbop_get_pipeline': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      if (ids.length === 0) return { error: 'Company not in scope' }

      const result = await query(
        `SELECT d.id, d.name, d.value, d.stage, d.service_type,
                d.company_id, d.owner_id, d.created_at, d.updated_at,
                co.name AS company_name,
                u.name  AS owner_name,
                cl.name AS client_name
         FROM sales_deals d
         LEFT JOIN companies co     ON co.id = d.company_id
         LEFT JOIN users u          ON u.id  = d.owner_id
         LEFT JOIN sales_clients cl ON cl.id = d.client_id
         WHERE d.company_id = ANY($1)
         ORDER BY d.stage, d.created_at DESC`,
        [ids]
      )

      const stages = ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
      const grouped: Record<string, { deals: unknown[]; total_value: number }> = {}
      for (const s of stages) grouped[s] = { deals: [], total_value: 0 }
      for (const row of result.rows) {
        const s = row.stage as string
        if (grouped[s]) {
          grouped[s].deals.push(row)
          grouped[s].total_value += parseFloat(String(row.value || 0))
        }
      }
      return grouped
    }

    // ── cbop_get_overdue_invoices ────────────────────────────────────────────
    case 'cbop_get_overdue_invoices': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      if (ids.length === 0) return { error: 'Company not in scope' }

      const result = await query(
        `SELECT i.id, i.invoice_no, i.total, i.due_date, i.status,
                cl.name AS client_name, cl.phone AS client_phone,
                co.name AS company_name,
                GREATEST(CURRENT_DATE - i.due_date::date, 0) AS days_overdue
         FROM sales_invoices i
         JOIN sales_clients cl ON cl.id = i.client_id
         JOIN companies co     ON co.id = i.company_id
         WHERE i.company_id = ANY($1)
           AND i.due_date < CURRENT_DATE AND i.status != 'paid'
         ORDER BY i.due_date ASC`,
        [ids]
      )
      return { invoices: result.rows }
    }

    // ── cbop_create_invoice ──────────────────────────────────────────────────
    case 'cbop_create_invoice': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const {
        client_id, amount, service_description, gst_type, due_date,
        notes, po_number, company_id: cid, hsn_code,
      } = args as {
        client_id: string; amount: number; service_description: string
        gst_type: string; due_date: string; notes?: string
        po_number?: string; company_id: string; hsn_code?: string
      }

      if (!cid || !user.companyIds.includes(cid)) return { error: 'Company not in scope' }

      const amt = parseFloat(String(amount))
      if (isNaN(amt) || amt <= 0) return { error: 'amount must be a positive number' }

      const gstAmount = Math.round(amt * 0.18 * 100) / 100
      const total     = Math.round((amt + gstAmount) * 100) / 100

      const coRes = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [cid])
      if (!coRes.rows.length) return { error: 'Company not found' }

      const prefix    = coRes.rows[0].invoice_prefix as string
      const invoiceNo = await generateInvoiceNumber(cid, prefix)

      const result = await query(
        `INSERT INTO sales_invoices
           (company_id, client_id, invoice_no, amount, gst_type, gst_amount, total,
            due_date, supply_date, rate, hsn_code, po_number, status,
            service_description, notes,
            machine_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$4,$9,$10,'draft',$11,$12,
           jsonb_build_object('created_by_mcp', true, 'reminder_count', 0))
         RETURNING id, invoice_no, total`,
        [
          cid, client_id, invoiceNo, amt, gst_type, gstAmount, total,
          due_date, hsn_code || '998314', po_number || null,
          service_description || null, notes || null,
        ]
      )

      return {
        invoice_id: result.rows[0].id,
        invoice_no: result.rows[0].invoice_no,
        total:      parseFloat(String(result.rows[0].total)),
      }
    }

    // ── cbop_send_invoice ────────────────────────────────────────────────────
    case 'cbop_send_invoice': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const invoiceId = await resolveInvoiceId(args.invoice_id as string)
      if (!invoiceId) return { error: 'Invoice not found' }

      const invRes = await query(
        `SELECT i.id, i.invoice_no, i.total,
                cl.phone AS client_phone, cl.name AS client_name,
                co.name  AS company_name
         FROM sales_invoices i
         JOIN sales_clients cl ON cl.id = i.client_id
         JOIN companies co     ON co.id = i.company_id
         WHERE i.id = $1 AND i.company_id = ANY($2)`,
        [invoiceId, user.companyIds]
      )
      if (!invRes.rows.length) return { error: 'Invoice not found' }

      const inv = invRes.rows[0]
      if (!inv.client_phone) return { error: 'Client has no phone number' }

      const pdf = await buildInvoicePdf(invoiceId)

      await sendViaOpenClaw({
        channel:    'whatsapp',
        to:         inv.client_phone as string,
        message:    `Please find attached invoice ${inv.invoice_no} for ₹${parseFloat(String(inv.total)).toLocaleString('en-IN', { minimumFractionDigits: 2 })} from ${inv.company_name}.`,
        attachment: pdf,
      })

      await query(
        `UPDATE sales_invoices
         SET status = 'sent',
             machine_data = machine_data || jsonb_build_object('sent_at', NOW()::TEXT, 'sent_via', 'mcp_whatsapp')
         WHERE id = $1`,
        [invoiceId]
      )

      await query(
        `INSERT INTO notifications_sent (user_id, channel, message)
         VALUES ($1, 'whatsapp', $2)`,
        [user.id, `Invoice ${inv.invoice_no as string} sent to ${inv.client_name as string}`]
      )

      return { sent: true, channel: 'whatsapp', invoice_no: inv.invoice_no }
    }

    // ── cbop_create_deal ─────────────────────────────────────────────────────
    case 'cbop_create_deal': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const { name, value, service_type, company_id: cid, client_id, stage, owner_id } = args as {
        name: string; value?: number; service_type?: string; company_id: string
        client_id?: string; stage?: string; owner_id?: string
      }
      if (!name?.trim()) return { error: 'name required' }
      if (!cid || !user.companyIds.includes(cid)) return { error: 'Company not in scope' }

      const result = await query(
        `INSERT INTO sales_deals (name, company_id, value, stage, service_type, client_id, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [name.trim(), cid, value || null, stage || 'lead', service_type || null, client_id || null, owner_id || user.id]
      )
      return { deal_id: result.rows[0].id }
    }

    // ── cbop_move_deal ───────────────────────────────────────────────────────
    case 'cbop_move_deal': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const { deal_id, stage, lost_reason } = args as {
        deal_id: string; stage: string; lost_reason?: string
      }

      const validStages = ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
      if (!validStages.includes(stage)) return { error: 'Invalid stage' }
      if (stage === 'closed_lost' && !lost_reason?.trim()) {
        return { error: 'lost_reason is required when marking a deal as lost' }
      }

      let updateResult
      if (stage === 'closed_lost') {
        updateResult = await query(
          `UPDATE sales_deals SET stage = $1, lost_reason = $2, closed_at = NOW()
           WHERE id = $3 AND company_id = ANY($4) RETURNING id`,
          [stage, lost_reason!.trim(), deal_id, user.companyIds]
        )
      } else if (stage === 'closed_won') {
        updateResult = await query(
          `UPDATE sales_deals SET stage = $1, closed_at = NOW()
           WHERE id = $2 AND company_id = ANY($3) RETURNING id`,
          [stage, deal_id, user.companyIds]
        )
      } else {
        updateResult = await query(
          `UPDATE sales_deals SET stage = $1
           WHERE id = $2 AND company_id = ANY($3) RETURNING id`,
          [stage, deal_id, user.companyIds]
        )
      }

      if (!updateResult.rows.length) return { error: 'Deal not found' }

      let jobId: string | null = null
      if (stage === 'closed_won') {
        const dealData = await query(
          `SELECT d.id, d.name, d.value, d.service_type, d.company_id,
                  cl.name AS client_name, cl.email AS client_email,
                  co.name AS company_name, u.name AS owner_name
           FROM sales_deals d
           LEFT JOIN sales_clients cl ON cl.id = d.client_id
           JOIN companies co          ON co.id = d.company_id
           LEFT JOIN users u          ON u.id  = d.owner_id
           WHERE d.id = $1`,
          [deal_id]
        )
        const deal = dealData.rows[0]
        const jobRes = await query(
          `INSERT INTO system_jobs (name, type, status, started_at, payload)
           VALUES ('deal_invoice_tasks', 'agent', 'running', NOW(), $1)
           RETURNING id`,
          [JSON.stringify({ deal_id })]
        )
        jobId = String(jobRes.rows[0].id)

        triggerAgent({ agent: 'deal_invoice_tasks', context: deal })
          .then(async (res) => {
            await query(
              `UPDATE system_jobs SET status = 'done', completed_at = NOW(), result = $1 WHERE id = $2`,
              [JSON.stringify(res ?? {}), jobId]
            )
          })
          .catch(async (err) => {
            const msg = err instanceof Error ? err.message : String(err)
            await query(
              `UPDATE system_jobs SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
              [msg, jobId]
            )
          })
      }

      return { deal_id, stage, ...(jobId ? { job_id: jobId } : {}) }
    }

    // ── cbop_create_task ─────────────────────────────────────────────────────
    case 'cbop_create_task': {
      const { title, project_id, owner_id, due_date, priority } = args as {
        title: string; project_id: string; owner_id?: string; due_date?: string; priority?: string
      }
      if (!title?.trim())  return { error: 'title required' }
      if (!project_id)     return { error: 'project_id required - every task must belong to a project' }

      const projectRes = await query(
        `SELECT id, company_id FROM ops_projects WHERE id = $1 AND company_id = ANY($2)`,
        [project_id, user.companyIds]
      )
      if (!projectRes.rows.length) return { error: 'Project not found' }

      const result = await query(
        `INSERT INTO ops_tasks (company_id, project_id, title, priority, status, due_date, owner_id)
         VALUES ($1,$2,$3,$4,'todo',$5,$6)
         RETURNING id`,
        [
          projectRes.rows[0].company_id, project_id, title.trim(),
          priority || 'medium', due_date || null, owner_id || user.id,
        ]
      )
      return { task_id: result.rows[0].id }
    }

    // ── cbop_complete_task ───────────────────────────────────────────────────
    case 'cbop_complete_task': {
      const { task_id } = args as { task_id: string }
      const result = await query(
        `UPDATE ops_tasks SET status = 'done'
         WHERE id = $1 AND company_id = ANY($2) RETURNING id`,
        [task_id, user.companyIds]
      )
      if (!result.rows.length) return { error: 'Task not found' }
      return { task_id, status: 'done' }
    }

    // ── cbop_get_tasks ───────────────────────────────────────────────────────
    case 'cbop_get_tasks': {
      const compIds = args.company_id ? ids : user.companyIds
      if (args.company_id && compIds.length === 0) return { error: 'Company not in scope' }

      const conditions: string[] = ['t.company_id = ANY($1)']
      const params: unknown[] = [compIds]
      let p = 2

      if (args.user_id) {
        const targetId = isSales ? (args.user_id as string) : user.id
        conditions.push(`t.owner_id = $${p++}`)
        params.push(targetId)
      }
      if (args.status) {
        conditions.push(`t.status = $${p++}`)
        params.push(args.status)
      }

      const result = await query(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.company_id,
                p.name AS project_name, u.name AS owner_name, co.name AS company_name
         FROM ops_tasks t
         LEFT JOIN ops_projects p ON p.id = t.project_id
         LEFT JOIN users u        ON u.id  = t.owner_id
         LEFT JOIN companies co   ON co.id = t.company_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`,
        params
      )
      return { tasks: result.rows }
    }

    // ── cbop_get_clients ─────────────────────────────────────────────────────
    case 'cbop_get_clients': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      if (ids.length === 0) return { error: 'Company not in scope' }

      const result = await query(
        `SELECT c.id, c.name, c.org_name, c.email, c.phone, c.company_id,
                co.name AS company_name,
                COUNT(DISTINCT d.id)::int                                       AS deals_count,
                COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0)::numeric AS total_billed
         FROM sales_clients c
         LEFT JOIN companies co     ON co.id = c.company_id
         LEFT JOIN sales_deals d    ON d.client_id = c.id
         LEFT JOIN sales_invoices i ON i.client_id = c.id
         WHERE c.company_id = ANY($1)
         GROUP BY c.id, co.name
         ORDER BY c.created_at DESC`,
        [ids]
      )
      return {
        clients: result.rows.map((r) => ({
          ...r,
          total_billed: parseFloat(String(r.total_billed)),
        })),
      }
    }

    // ── cbop_create_lead ─────────────────────────────────────────────────────
    case 'cbop_create_lead': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const { name, org, email, phone, source, owner_id, company_id: cid } = args as {
        name: string; org?: string; email?: string; phone?: string
        source?: string; owner_id?: string; company_id: string
      }
      if (!name?.trim()) return { error: 'name required' }
      if (!cid || !user.companyIds.includes(cid)) return { error: 'Company not in scope' }

      const result = await query(
        `INSERT INTO sales_leads (company_id, name, email, phone, org_name, source, status, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,'new',$7)
         RETURNING id`,
        [cid, name.trim(), email || null, phone || null, org || null, source || 'other', owner_id || user.id]
      )

      fireN8nWebhook('lead-updated', { lead_id: result.rows[0].id })
      return { lead_id: result.rows[0].id }
    }

    // ── cbop_convert_lead ────────────────────────────────────────────────────
    case 'cbop_convert_lead': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const { lead_id, deal_name, deal_value, service_type } = args as {
        lead_id: string; deal_name?: string; deal_value?: number; service_type?: string
      }

      const leadRes = await query(
        `SELECT id, company_id, name, email, phone, org_name, owner_id, status
         FROM sales_leads WHERE id = $1 AND company_id = ANY($2)`,
        [lead_id, user.companyIds]
      )
      if (!leadRes.rows.length) return { error: 'Lead not found' }
      const lead = leadRes.rows[0]
      if (lead.status === 'converted') return { error: 'Lead already converted' }

      let clientId: string
      let isNewClient = false

      if (lead.email) {
        const existing = await query(
          `SELECT id FROM sales_clients WHERE company_id = $1 AND email = $2 LIMIT 1`,
          [lead.company_id, lead.email]
        )
        if (existing.rows.length) {
          clientId = existing.rows[0].id as string
        } else {
          isNewClient = true
        }
      } else {
        isNewClient = true
      }

      if (isNewClient) {
        const nc = await query(
          `INSERT INTO sales_clients (company_id, name, email, phone, org_name, added_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [lead.company_id, lead.name, lead.email || null, lead.phone || null, lead.org_name || null, user.id]
        )
        clientId = nc.rows[0].id as string
      }

      const dealRes = await query(
        `INSERT INTO sales_deals (company_id, lead_id, client_id, name, value, service_type, stage, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,'lead',$7) RETURNING id`,
        [
          lead.company_id, lead_id, clientId!,
          deal_name || `${(lead.org_name as string) || (lead.name as string)} Deal`,
          deal_value ? parseFloat(String(deal_value)) : null,
          service_type || null,
          (lead.owner_id as string) || user.id,
        ]
      )

      await query(`UPDATE sales_leads SET status = 'converted' WHERE id = $1`, [lead_id])

      fireN8nWebhook('lead-updated', { lead_id })
      if (isNewClient) {
        fireN8nWebhook('client-created', {
          client_id:    clientId!,
          service_type: service_type || '',
          deal_id:      dealRes.rows[0].id,
        })
      }

      return { deal_id: dealRes.rows[0].id, client_id: clientId! }
    }

    // ── cbop_send_invoice_reminder ───────────────────────────────────────────
    case 'cbop_send_invoice_reminder': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const invoiceId = args.invoice_id as string
      const channelOverride = args.channel as string | undefined
      const toOverride      = args.to      as string | undefined

      const res = await query(
        `SELECT i.id, i.invoice_no, i.total, i.due_date,
                cl.name AS client_name, cl.phone AS client_phone,
                co.name AS company_name,
                COALESCE((i.machine_data->>'reminder_count')::int, 0) AS reminder_count
         FROM sales_invoices i
         JOIN sales_clients cl ON cl.id = i.client_id
         JOIN companies co     ON co.id = i.company_id
         WHERE i.id = $1 AND i.company_id = ANY($2)`,
        [invoiceId, user.companyIds]
      )
      if (!res.rows.length) return { error: 'Invoice not found' }
      const inv = res.rows[0]

      if (channelOverride === 'whatsapp' && toOverride) {
        const amount = parseFloat(String(inv.total)).toLocaleString('en-IN', { minimumFractionDigits: 2 })
        const msg = `Payment Reminder - Invoice ${inv.invoice_no as string}\nClient: ${inv.client_name as string}\nAmount: ₹${amount}\nDue: ${inv.due_date as string}\nCompany: ${inv.company_name as string}`

        await sendViaOpenClaw({ channel: 'whatsapp', to: toOverride, message: msg })
      } else {
        if (!inv.client_phone) return { error: 'Client has no phone number' }
        await sendViaOpenClaw({
          channel:  'whatsapp',
          to:       inv.client_phone as string,
          template: 'invoice_reminder',
          vars: {
            client_name: inv.client_name  as string,
            invoice_no:  inv.invoice_no   as string,
            amount:      String(inv.total),
            due_date:    inv.due_date     as string,
            company:     inv.company_name as string,
          },
        })
      }

      const newCount = ((inv.reminder_count as number) || 0) + 1
      await query(
        `UPDATE sales_invoices
         SET machine_data = COALESCE(machine_data, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ reminder_count: newCount, last_reminder_at: new Date().toISOString() }), invoiceId]
      )

      return { sent: true, reminder_count: newCount, to: toOverride || (inv.client_phone as string) }
    }

    // ── cbop_get_system_health ───────────────────────────────────────────────
    case 'cbop_get_system_health': {
      const result = await query(
        `SELECT id, name, type, status, started_at, completed_at, error_message
         FROM system_jobs ORDER BY created_at DESC LIMIT 10`
      )
      return { jobs: result.rows }
    }

    // ── cbop_get_morning_briefing ────────────────────────────────────────────
    case 'cbop_get_morning_briefing': {
      const targetUserId = (args.user_id as string) || user.id

      const [overdueInvoices, openDeals, tasksDueToday, staleDeals, recentAutomations] = await Promise.all([
        isSales
          ? query(
              `SELECT i.id, i.invoice_no, i.total, i.due_date,
                      cl.name AS client_name, co.name AS company_name,
                      GREATEST(CURRENT_DATE - i.due_date::date, 0) AS days_overdue
               FROM sales_invoices i
               JOIN sales_clients cl ON cl.id = i.client_id
               JOIN companies co     ON co.id = i.company_id
               WHERE i.company_id = ANY($1)
                 AND i.due_date < CURRENT_DATE AND i.status != 'paid'
               ORDER BY i.due_date ASC LIMIT 20`,
              [user.companyIds]
            )
          : Promise.resolve({ rows: [] }),

        isSales
          ? query(
              `SELECT COUNT(*)::int AS count, COALESCE(SUM(value), 0)::numeric AS pipeline_value
               FROM sales_deals
               WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')`,
              [user.companyIds]
            )
          : Promise.resolve({ rows: [{ count: 0, pipeline_value: '0' }] }),

        query(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date,
                  p.name AS project_name, co.name AS company_name
           FROM ops_tasks t
           LEFT JOIN ops_projects p ON p.id = t.project_id
           LEFT JOIN companies co   ON co.id = t.company_id
           WHERE t.owner_id = $1 AND t.company_id = ANY($2)
             AND t.status != 'done'
             AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE)
           ORDER BY t.due_date ASC NULLS LAST LIMIT 20`,
          [targetUserId, user.companyIds]
        ),

        isSales
          ? query(
              `SELECT d.id, d.name, d.stage, d.value,
                      co.name AS company_name,
                      EXTRACT(DAY FROM NOW() - d.updated_at)::int AS days_stale
               FROM sales_deals d
               JOIN companies co ON co.id = d.company_id
               WHERE d.company_id = ANY($1)
                 AND d.stage NOT IN ('closed_won','closed_lost')
                 AND d.updated_at < NOW() - INTERVAL '7 days'
               ORDER BY d.updated_at ASC`,
              [user.companyIds]
            )
          : Promise.resolve({ rows: [] }),

        query(
          `SELECT id, name, type, status, completed_at, error_message
           FROM system_jobs ORDER BY created_at DESC LIMIT 5`
        ),
      ])

      const cashPositions: Record<string, number> = {}
      if (isCeo) {
        const cashRes = await query(
          `SELECT fcp.company_id, co.name AS company_name, fcp.amount
           FROM finance_cash_position fcp
           JOIN companies co ON co.id = fcp.company_id
           WHERE fcp.company_id = ANY($1)`,
          [user.companyIds]
        )
        for (const row of cashRes.rows) {
          cashPositions[row.company_name as string] = parseFloat(String(row.amount))
        }
      }

      // Hiring summary for morning briefing
      const [hiringPendingRes, hiringInterviewsRes, hiringOffersRes] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'applied'`,
          [user.companyIds],
        ),
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'interview_scheduled'
             AND interview_at::date = CURRENT_DATE`,
          [user.companyIds],
        ),
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'offer_sent'`,
          [user.companyIds],
        ),
      ])

      return {
        date:               new Date().toISOString().split('T')[0],
        overdue_invoices:   overdueInvoices.rows,
        open_deals_count:   openDeals.rows[0].count as number,
        pipeline_value:     parseFloat(String(openDeals.rows[0].pipeline_value)),
        tasks_due_today:    tasksDueToday.rows,
        stale_deals:        staleDeals.rows,
        recent_automations: recentAutomations.rows,
        cash_positions:     isCeo ? cashPositions : undefined,
        hiring: {
          pending_review:           hiringPendingRes.rows[0]?.count || 0,
          interviews_today:         hiringInterviewsRes.rows[0]?.count || 0,
          offers_awaiting_response: hiringOffersRes.rows[0]?.count || 0,
        },
      }
    }

    // ── cbop_create_project ──────────────────────────────────────────────────
    case 'cbop_create_project': {
      const { name, company_id: cid, owner_id, deadline, description } = args as {
        name: string; company_id: string; owner_id?: string; deadline?: string; description?: string
      }
      if (!name?.trim()) return { error: 'name required' }
      if (!cid || !user.companyIds.includes(cid)) return { error: 'Company not in scope' }

      const result = await query(
        `INSERT INTO ops_projects (company_id, name, description, deadline, owner_id, status)
         VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
        [cid, name.trim(), description || null, deadline || null, owner_id || user.id]
      )
      return { project_id: result.rows[0].id }
    }

    // ── cbop_update_lead ─────────────────────────────────────────────────────
    case 'cbop_update_lead': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const { lead_id, notes, score, status: leadStatus, last_contact_at } = args as {
        lead_id: string; notes?: string; score?: number; status?: string; last_contact_at?: string
      }

      const result = await query(
        `UPDATE sales_leads
         SET notes           = COALESCE($1, notes),
             score           = COALESCE($2, score),
             status          = COALESCE($3, status),
             last_contact_at = COALESCE($4, last_contact_at)
         WHERE id = $5 AND company_id = ANY($6)
         RETURNING id`,
        [notes || null, score ?? null, leadStatus || null, last_contact_at || null, lead_id, user.companyIds]
      )
      if (!result.rows.length) return { error: 'Lead not found' }

      fireN8nWebhook('lead-updated', { lead_id })
      return { lead_id }
    }

    // ── cbop_create_social_post ──────────────────────────────────────────────
    case 'cbop_create_social_post': {
      const { content, platform, company_id: cid, scheduled_at } = args as {
        content: string; platform: string; company_id: string; scheduled_at?: string
      }
      if (!content?.trim()) return { error: 'content required' }
      if (!cid || !user.companyIds.includes(cid)) return { error: 'Company not in scope' }

      const validPlatforms = ['linkedin', 'instagram', 'twitter']
      if (!validPlatforms.includes(platform)) return { error: `platform must be one of: ${validPlatforms.join(', ')}` }

      const result = await query(
        `INSERT INTO marketing_social_posts (company_id, content, platform, scheduled_at, status)
         VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
        [cid, content.trim(), platform, scheduled_at || null]
      )
      return { post_id: result.rows[0].id }
    }

    // ── cbop_send_pdf ────────────────────────────────────────────────────────
    case 'cbop_send_pdf': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }
      const invoiceId = await resolveInvoiceId(args.invoice_id as string)
      if (!invoiceId) return { error: 'Invoice not found' }

      const channel = (args.channel as string | undefined) || 'telegram'

      const invRes = await query(
        `SELECT i.id, i.invoice_no, i.total, i.due_date, co.name AS company_name
         FROM sales_invoices i
         JOIN companies co ON co.id = i.company_id
         WHERE i.id = $1 AND i.company_id = ANY($2)`,
        [invoiceId, user.companyIds]
      )
      if (!invRes.rows.length) return { error: 'Invoice not found' }
      const inv = invRes.rows[0]

      const total    = parseFloat(String(inv.total))
      const dueDate  = new Date(inv.due_date as string).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      const caption  = `Invoice ${inv.invoice_no as string} - ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })} - Due ${dueDate}`
      const pdf      = await buildInvoicePdf(invoiceId)

      if (channel === 'telegram') {
        const chatId = (args.to as string | undefined) || (args.caller_telegram_id as string)

        await sendViaOpenClaw({
          channel:    'telegram',
          to:         chatId,
          message:    caption,
          attachment: Buffer.from(pdf),
        })

        return { sent: true, channel: 'telegram', to: chatId, invoice_no: inv.invoice_no }
      }

      if (channel === 'whatsapp') {
        const to = args.to as string | undefined
        if (!to) return { error: 'to (WhatsApp group JID or phone) is required for channel=whatsapp' }

        const tmpPath = `/tmp/${inv.invoice_no as string}.pdf`
        await writeFile(tmpPath, pdf)

        // Send PDF via OpenClaw /send with attachment
        const openClawUrl = process.env.OPENCLAW_URL || process.env.HERMES_URL || 'http://127.0.0.1:18790'
        const openClawKey = process.env.OPENCLAW_API_KEY || process.env.HERMES_API_KEY || ''
        try {
          const formData = new FormData()
          formData.append('channel', 'whatsapp')
          formData.append('to', to)
          formData.append('message', caption)
          const { readFile } = await import('fs/promises')
          const fileBytes = await readFile(tmpPath)
          formData.append('attachment', new Blob([fileBytes], { type: 'application/pdf' }), `${inv.invoice_no}.pdf`)

          const res = await fetch(`${openClawUrl}/send`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${openClawKey}` },
            body:    formData,
          })
          if (!res.ok) throw new Error(await res.text())
        } catch (err) {
          await unlink(tmpPath).catch(() => {})
          const msg = err instanceof Error ? err.message : String(err)
          return { error: `OpenClaw send error: ${msg}` }
        }

        await unlink(tmpPath).catch(() => {})
        return { sent: true, channel: 'whatsapp', to, invoice_no: inv.invoice_no }
      }

      return { error: `Invalid channel: ${channel}` }
    }

    // ── cbop_send_pdf_to_telegram ────────────────────────────────────────────
    case 'cbop_send_pdf_to_telegram': {
      return executeTool('cbop_send_pdf', {
        ...args,
        channel: 'telegram',
        to: args.chat_id,
      }, user)
    }

    // ── cbop_get_projects ────────────────────────────────────────────────────
    case 'cbop_get_projects': {
      const compIds = args.company_id ? ids : user.companyIds
      if (args.company_id && compIds.length === 0) return { error: 'Company not in scope' }

      const conditions: string[] = ['p.company_id = ANY($1)']
      const params: unknown[] = [compIds]
      let p = 2

      if (args.owner_id) {
        conditions.push(`p.owner_id = $${p++}`)
        params.push(args.owner_id)
      }
      if (args.status) {
        conditions.push(`p.status = $${p++}`)
        params.push(args.status)
      }

      const result = await query(
        `SELECT p.id, p.name, c.name AS company_name,
                u.name AS owner_name, p.status, p.deadline,
                COUNT(t.id)::int AS task_count
         FROM ops_projects p
         JOIN companies c        ON c.id = p.company_id
         LEFT JOIN users u       ON u.id = p.owner_id
         LEFT JOIN ops_tasks t   ON t.project_id = p.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY p.id, c.name, u.name
         ORDER BY p.deadline ASC NULLS LAST, p.created_at DESC`,
        params
      )
      return { projects: result.rows }
    }

    // ── cbop_get_team ────────────────────────────────────────────────────────
    case 'cbop_get_team': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const result = await query(
        `SELECT u.id, u.name, u.role, u.telegram_chat_id,
                COUNT(DISTINCT t.id)::int  AS open_tasks_count,
                COUNT(DISTINCT p.id)::int  AS projects_count
         FROM users u
         LEFT JOIN ops_tasks t    ON t.owner_id = u.id AND t.status != 'done'
         LEFT JOIN ops_projects p ON p.owner_id = u.id AND p.status = 'active'
         GROUP BY u.id
         ORDER BY u.name`
      )
      return { team: result.rows }
    }

    // ── cbop_search_invoices ─────────────────────────────────────────────────
    case 'cbop_search_invoices': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const conditions: string[] = ['i.company_id = ANY($1)']
      const params: unknown[]   = [user.companyIds]
      let p = 2

      if (args.client_name) {
        conditions.push(`(cl.name ILIKE $${p} OR cl.org_name ILIKE $${p})`)
        params.push(`%${args.client_name}%`)
        p++
      }

      if (args.amount != null) {
        const amt = parseFloat(String(args.amount))
        conditions.push(`i.total BETWEEN $${p} AND $${p + 1}`)
        params.push(amt * 0.8, amt * 1.2)
        p += 2
      }

      if (args.month) {
        const range = parseMonthRange(String(args.month))
        if (range) {
          conditions.push(`i.created_at >= $${p} AND i.created_at < $${p + 1}`)
          params.push(range.start, range.end)
          p += 2
        }
      }

      if (args.description) {
        conditions.push(`i.service_description ILIKE $${p}`)
        params.push(`%${args.description}%`)
        p++
      }

      if (args.status) {
        conditions.push(`i.status = $${p}`)
        params.push(args.status)
        p++
      }

      const result = await query(
        `SELECT i.invoice_no, i.total, i.status, i.due_date, i.service_description,
                cl.name AS client_name, cl.org_name
         FROM sales_invoices i
         JOIN sales_clients cl ON cl.id = i.client_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY i.created_at DESC
         LIMIT 20`,
        params
      )

      return {
        invoices: result.rows.map((r) => ({ ...r, total: parseFloat(String(r.total)) })),
      }
    }

    // ── cbop_get_hiring_summary ──────────────────────────────────────────────
    case 'cbop_get_hiring_summary': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const [pendingRes, shortlistedRes, interviewsRes, offersRes] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'applied'`,
          [user.companyIds],
        ),
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'shortlisted'`,
          [user.companyIds],
        ),
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'interview_scheduled'
             AND interview_at::date = CURRENT_DATE`,
          [user.companyIds],
        ),
        query(
          `SELECT COUNT(*)::int AS count FROM hiring_applicants
           WHERE company_id = ANY($1) AND stage = 'offer_sent'`,
          [user.companyIds],
        ),
      ])

      return {
        pending_review:          pendingRes.rows[0]?.count || 0,
        shortlisted_count:       shortlistedRes.rows[0]?.count || 0,
        interviews_today:        interviewsRes.rows[0]?.count || 0,
        offers_awaiting_response: offersRes.rows[0]?.count || 0,
      }
    }

    // ── cbop_get_applicants ──────────────────────────────────────────────────
    case 'cbop_get_applicants': {
      if (!isSales) return { error: 'Forbidden' }

      const conditions: string[] = ['a.company_id = ANY($1)']
      const params: unknown[]    = [user.companyIds]
      let p = 2

      if (args.stage) { conditions.push(`a.stage = $${p++}`); params.push(args.stage) }
      if (args.role)  { conditions.push(`r.title ILIKE $${p++}`); params.push(`%${String(args.role)}%`) }

      const limit = Math.min(Number(args.limit) || 10, 50)

      const result = await query(
        `SELECT a.id, a.name, a.email, a.college, a.year_of_study,
                a.ai_score, a.ai_summary, a.stage, a.created_at,
                r.title AS role_title, co.name AS company_name
         FROM hiring_applicants a
         LEFT JOIN hiring_roles r ON r.id = a.role_id
         LEFT JOIN companies co   ON co.id = a.company_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.ai_score DESC, a.created_at DESC
         LIMIT $${p}`,
        [...params, limit],
      )

      return { applicants: result.rows }
    }

    // ── cbop_shortlist_applicant ─────────────────────────────────────────────
    case 'cbop_shortlist_applicant': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const appRes = await query(
        `SELECT a.id, a.name, a.company_id FROM hiring_applicants a
         WHERE a.id = $1 AND a.company_id = ANY($2)`,
        [args.applicant_id, user.companyIds],
      )
      if (!appRes.rows.length) return { error: 'Applicant not found or out of scope' }

      await query(
        `UPDATE hiring_applicants SET stage = 'shortlisted',
           reviewed_by = $2, reviewed_at = NOW(),
           review_notes = COALESCE($3, review_notes)
         WHERE id = $1`,
        [args.applicant_id, user.id, args.notes || null],
      )

      return { applicant_id: args.applicant_id, stage: 'shortlisted' }
    }

    // ── cbop_reject_applicant ────────────────────────────────────────────────
    case 'cbop_reject_applicant': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const appRes = await query(
        `SELECT a.*, r.title AS role_title, co.name AS company_name
         FROM hiring_applicants a
         LEFT JOIN hiring_roles r ON r.id = a.role_id
         LEFT JOIN companies co   ON co.id = a.company_id
         WHERE a.id = $1 AND a.company_id = ANY($2)`,
        [args.applicant_id, user.companyIds],
      )
      if (!appRes.rows.length) return { error: 'Applicant not found or out of scope' }

      const applicant = appRes.rows[0]

      if (args.send_now) {
        // Fire rejection email immediately via CBOP endpoint
        const cbopUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'
        await fetch(`${cbopUrl}/api/hiring/applicants/${args.applicant_id}/send-rejection`, {
          method: 'POST',
          headers: { 'x-cbop-secret': process.env.N8N_WEBHOOK_SECRET || '' },
        }).catch(() => {})

        await query(
          `UPDATE hiring_applicants SET stage = 'rejected',
             rejection_reason = $2, rejection_queued_at = NOW()
           WHERE id = $1`,
          [args.applicant_id, args.reason],
        )

        return { applicant_id: args.applicant_id, rejection_sent: true, sends_at: new Date().toISOString() }
      }

      await query(
        `UPDATE hiring_applicants SET stage = 'rejected',
           rejection_reason = $2, rejection_queued_at = NOW()
         WHERE id = $1`,
        [args.applicant_id, args.reason],
      )

      const sendsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      return { applicant_id: args.applicant_id, rejection_sent: false, sends_at: sendsAt }
    }

    // ── cbop_get_active_interns ──────────────────────────────────────────────
    case 'cbop_get_active_interns': {
      if (!isSales) return { error: 'Forbidden: CEO/COO only' }

      const conditions: string[] = ["ir.company_id = ANY($1) AND ir.status = 'active'"]
      const params: unknown[]    = [user.companyIds]
      let p = 2

      if (args.company_id) {
        if (!user.companyIds.includes(String(args.company_id))) return { error: 'Company not in scope' }
        conditions.push(`ir.company_id = $${p++}`)
        params.push(args.company_id)
      }

      const result = await query(
        `SELECT ir.id, a.name, a.email, r.title AS role_title,
                co.name AS company_name, u.name AS team_lead_name,
                ir.start_date, ir.status
         FROM intern_records ir
         JOIN hiring_applicants a ON a.id = ir.applicant_id
         LEFT JOIN hiring_roles r ON r.id = ir.role_id
         LEFT JOIN companies co   ON co.id = ir.company_id
         LEFT JOIN users u        ON u.id  = ir.team_lead_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ir.created_at DESC`,
        params,
      )

      return { interns: result.rows }
    }

    // ── cbop_list_document_templates ────────────────────────────────────────
    case 'cbop_list_document_templates': {
      const scopeIds = args.company_id
        ? scopedIds(user, args.company_id as string)
        : user.companyIds
      if (!scopeIds.length) return { error: 'No companies in scope' }

      const result = await query(
        `SELECT dt.id, dt.name, dt.doc_type, dt.tags, dt.canvas_width, dt.canvas_height,
                co.name AS company_name,
                (SELECT COUNT(*)::int FROM document_batches db WHERE db.template_id = dt.id) AS batch_count
         FROM document_templates dt
         JOIN companies co ON co.id = dt.company_id
         WHERE dt.company_id = ANY($1)
         ORDER BY dt.updated_at DESC`,
        [scopeIds]
      )
      return { templates: result.rows }
    }

    // ── cbop_generate_documents ──────────────────────────────────────────────
    case 'cbop_generate_documents': {
      const templateId  = args.template_id as string
      const recipients  = args.recipients as Record<string, string>[]
      const sendEmail   = !!(args.send_email)
      const batchName   = (args.batch_name as string | undefined) || 'Nila-triggered batch'

      if (!templateId) return { error: 'template_id required' }
      if (!recipients?.length) return { error: 'recipients array required' }
      if (recipients.length > 500) return { error: 'Max 500 recipients per Nila batch' }

      const { rows: [template] } = await query(
        `SELECT id, company_id FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
        [templateId, user.companyIds]
      )
      if (!template) return { error: 'Template not found or not in scope' }

      const { rows: [batch] } = await query(
        `INSERT INTO document_batches
           (template_id, company_id, name, status, total_count, send_email, created_by)
         VALUES ($1,$2,$3,'pending',$4,$5,$6) RETURNING id`,
        [templateId, template.company_id, batchName, recipients.length, sendEmail, user.id]
      )

      // Start generation in background (non-blocking)
      const { runBatch } = await import('./documents')
      void runBatch(batch.id as string, template as Record<string, unknown>, recipients, sendEmail)

      return { batch_id: batch.id, total: recipients.length, message: `Generation started. Check status with cbop_get_document_batch_status.` }
    }

    // ── cbop_get_document_batch_status ───────────────────────────────────────
    case 'cbop_get_document_batch_status': {
      const batchId = args.batch_id as string
      const { rows: [batch] } = await query(
        `SELECT db.id, db.name, db.status, db.total_count, db.done_count,
                db.send_email, db.error_message, db.created_at,
                dt.name AS template_name
         FROM document_batches db
         JOIN document_templates dt ON dt.id = db.template_id
         WHERE db.id = $1 AND db.company_id = ANY($2)`,
        [batchId, user.companyIds]
      )
      if (!batch) return { error: 'Batch not found' }

      const pct = batch.total_count
        ? Math.round((batch.done_count / batch.total_count) * 100)
        : 0
      return { ...batch, progress_pct: pct }
    }

    // ── cbop_create_blog_draft ───────────────────────────────────────────────
    case 'cbop_create_blog_draft': {
      if (!isCeo) return { error: 'Forbidden: CEO only' }
      const companyId = args.company_id as string
      if (!companyId || !ids.includes(companyId)) return { error: 'company_id required and must be in scope' }

      const title = String(args.title || '').trim()
      if (!title) return { error: 'title required' }
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || `post-${Date.now()}`

      const result = await query(
        `INSERT INTO blog_posts (company_id, title, slug, excerpt, content, category, tags, author_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft')
         ON CONFLICT (company_id, slug) DO UPDATE SET slug = EXCLUDED.slug || '-' || substr(md5(random()::text), 1, 6)
         RETURNING id, title, slug, status`,
        [companyId, title, slug, args.excerpt ?? null, String(args.content || ''), args.category ?? null,
         Array.isArray(args.tags) ? args.tags : [], user.id]
      )
      return { draft: result.rows[0], note: 'Draft created - review and publish it in CBOP at /blog before it goes live.' }
    }

    // ── cbop_seo_score_draft ─────────────────────────────────────────────────
    case 'cbop_seo_score_draft': {
      if (!isCeo) return { error: 'Forbidden: CEO only' }
      const title = String(args.title || '')
      const metaDesc = String(args.meta_description || '')
      const content = String(args.content || '')
      const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const wordCount = plainText ? plainText.split(' ').length : 0

      const issues: string[] = []
      if (title.length < 10 || title.length > 60) issues.push(`Title is ${title.length} chars - Google's practical display range is 10-60`)
      if (metaDesc && (metaDesc.length < 50 || metaDesc.length > 160)) issues.push(`Meta description is ${metaDesc.length} chars - ideal range is 50-160`)
      if (!metaDesc) issues.push('No meta description provided')
      if (wordCount < 300) issues.push(`Body is only ${wordCount} words - short posts tend to rank worse for competitive queries`)
      if (!/<h[1-3]/i.test(content) && content.includes('<')) issues.push('No H1-H3 headings found in the body - heading structure helps both readers and search engines')

      const score = Math.max(0, 100 - issues.length * 15)
      return { score, word_count: wordCount, issues }
    }

    // ── cbop_seo_query_gaps ───────────────────────────────────────────────────
    case 'cbop_seo_query_gaps': {
      if (!isCeo) return { error: 'Forbidden: CEO only' }
      const connectionId = args.connection_id as string
      if (!connectionId) return { error: 'connection_id required' }

      const conn = await getConnection(connectionId, ids)
      if (!conn) return { error: 'Connection not found or not in scope' }
      if (conn.site_url === 'pending-site-selection') return { error: 'This connection has not had a verified site picked yet - finish setup in Settings > SEO Connections' }

      const days = Math.min(90, Math.max(7, Number(args.days) || 28))
      const end = new Date()
      const start = new Date(end.getTime() - days * 86400000)
      const fmt = (d: Date) => d.toISOString().slice(0, 10)

      try {
        const accessToken = await getValidAccessToken(conn)
        const rows = await getSearchAnalytics(accessToken, conn.site_url, {
          startDate: fmt(start), endDate: fmt(end), dimensions: ['query'], rowLimit: 200,
        })
        const gaps = (rows as SearchAnalyticsRow[])
          .filter(r => r.impressions >= 10 && (r.position > 10 || r.ctr < 0.02))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 20)
          .map(r => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, avg_position: r.position }))

        return {
          gaps,
          note: gaps.length === 0
            ? 'No clear gaps found in this window - either the site is doing well, or there is not enough search data yet.'
            : 'These are real queries people search that show your site but rank poorly or get skipped - good raw material for new post topics.',
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to fetch Search Console data' }
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── MCP endpoint ──────────────────────────────────────────────────────────────

app.post('/api/mcp', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!MCP_TOKEN || token !== MCP_TOKEN) {
    void writeAuditLog({
      action:       AUDIT_ACTIONS.mcpDenied,
      resourceType: 'mcp',
      resourceId:   '/api/mcp',
      after:        { reason: MCP_TOKEN ? 'invalid_mcp_token' : 'mcp_token_not_configured' },
      ipAddress:    getClientIp(c),
      userAgent:    c.req.header('user-agent') ?? null,
    })
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401)
  }

  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> }
  try {
    body = await c.req.json()
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400)
  }

  const { id, method, params } = body

  try {
    if (method === 'initialize') {
      return c.json(rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'cbop-mcp', version: '1.0.0' },
      }))
    }

    if (method === 'tools/list') {
      return c.json(rpcResult(id, { tools: TOOL_DEFS }))
    }

    if (method === 'tools/call') {
      const toolName = params?.name as string
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>

      const ip = getClientIp(c)
      const ua = c.req.header('user-agent') ?? null

      if (!toolArgs.caller_telegram_id) {
        void writeAuditLog({
          action:       AUDIT_ACTIONS.mcpDenied,
          resourceType: 'mcp_tool',
          resourceId:   toolName,
          after:        { reason: 'missing_caller_telegram_id', arguments: toolArgs },
          ipAddress:    ip,
          userAgent:    ua,
        })
        return c.json(rpcResult(id, toolResult({ error: 'caller_telegram_id is required in every tool call' })))
      }

      const user = await resolveCallerUser(String(toolArgs.caller_telegram_id))
      if (!user) {
        void writeAuditLog({
          action:       AUDIT_ACTIONS.mcpDenied,
          resourceType: 'mcp_tool',
          resourceId:   toolName,
          after:        {
            reason: 'caller_telegram_id_not_mapped',
            caller_telegram_id: String(toolArgs.caller_telegram_id),
            arguments: toolArgs,
          },
          ipAddress: ip,
          userAgent: ua,
        })
        return c.json(rpcResult(id, toolResult({ error: 'Caller not found - telegram_id not mapped to a CBOP user' })))
      }

      // Agents act on a real user's behalf: run the tool inside that user's
      // actor context so every audit row and every transaction() below records
      // the human it was done for, not an anonymous agent.
      const auditBase = {
        action:       AUDIT_ACTIONS.mcpToolCall,
        resourceType: 'mcp_tool',
        resourceId:   toolName,
        actorId:      user.id,
        actorRole:    user.role,
        companyId:    typeof toolArgs.company_id === 'string' ? toolArgs.company_id : null,
        ipAddress:    ip,
        userAgent:    ua,
      }

      try {
        const result = await runWithActorContext(
          { userId: user.id, role: user.role, companyIds: user.companyIds },
          () => executeTool(toolName, toolArgs, user)
        )
        // Full arguments are recorded (audit-log.ts redacts credential-shaped
        // keys); the result is not — it can be an entire dataset.
        void writeAuditLog({ ...auditBase, after: { arguments: toolArgs, ok: true } })
        return c.json(rpcResult(id, toolResult(result)))
      } catch (err) {
        void writeAuditLog({
          ...auditBase,
          after: { arguments: toolArgs, ok: false, error: err instanceof Error ? err.message : String(err) },
        })
        throw err
      }
    }

    return c.json(rpcError(id, -32601, `Method not found: ${method}`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MCP]', method, msg)
    return c.json(rpcError(id, -32603, msg))
  }
})

export default app
