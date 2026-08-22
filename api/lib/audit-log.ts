/**
 * Audit trail writer — the single writer for the `audit_logs` table.
 *
 * Schema and column semantics: migrations/059_audit_logs.sql.
 * `audit_logs` is append-only at the database level (a trigger RAISEs on
 * UPDATE/DELETE), so there is no update or delete counterpart here by design.
 *
 * Coverage this file exists to serve (IF-2):
 *   - auth success / failure / lockout / session rejection  (api/index.ts, require-auth)
 *   - every authorization denial — the 403s                 (require-role, require-module, settings)
 *   - admin actions: role changes, company edits, integrations (routes/settings)
 *   - data exports and bulk reads                           (invoices, documents, hiring)
 *   - every MCP/agent tool invocation, with arguments       (routes/mcp)
 *
 * Failure policy: a failed audit write is logged to stderr and swallowed. An
 * audit outage must not take the platform down; it must be loud instead.
 * Nothing here ever throws.
 */

import type { Context } from 'hono'
import { query, getActorContext } from './db'
import './hono-vars'

// ── Event names ───────────────────────────────────────────────────────────────
// Dot-namespaced. Keep new events inside an existing prefix where one fits.

export const AUDIT_ACTIONS = {
  authSignInSuccess:  'auth.sign_in.success',
  authSignInFailure:  'auth.sign_in.failure',
  authSignOut:        'auth.sign_out',
  authRateLimited:    'auth.rate_limited',
  authSessionActive:  'auth.session.active',
  authSessionRejected:'auth.session.rejected',
  authzRoleDenied:    'authz.role.denied',
  authzModuleDenied:  'authz.module.denied',
  authzRouteDenied:   'authz.route.denied',
  mcpToolCall:        'mcp.tool.call',
  mcpDenied:          'mcp.denied',

  // Admin actions — anything that changes who can do what, or how the platform
  // talks to the outside world.
  adminUserCreate:        'admin.user.create',
  adminUserUpdate:        'admin.user.update',
  adminUserInvite:        'admin.user.invite',
  adminUserRoleChange:    'admin.user.role_change',
  adminUserCompanyRemove: 'admin.user.company_remove',
  adminCompanyCreate:     'admin.company.create',
  adminCompanyUpdate:     'admin.company.update',
  adminCompanyBranding:   'admin.company.branding_update',
  adminModuleToggle:      'admin.company.module_toggle',
  adminRoleCreate:        'admin.role.create',
  adminRoleUpdate:        'admin.role.update',
  adminRoleDelete:        'admin.role.delete',
  adminRolePermissions:   'admin.role.permissions_update',
  adminIntegrationsRead:  'admin.integrations.read',

  // Data exports and bulk reads of personal data.
  exportInvoicePdf:   'export.invoice_pdf',
  exportDocumentPdf:  'export.document_pdf',
  exportApplicantFile:'export.applicant_file',
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  /** Dot-namespaced event name. Required. */
  action: string
  /** Kind of thing acted on: 'route', 'module', 'user', 'company', 'mcp_tool', ... */
  resourceType?: string | null
  /** Row id, module key, tool name, route path — anything identifying. */
  resourceId?: string | null
  actorId?: string | null
  /** Role snapshot at the time of the action. Never re-derived later. */
  actorRole?: string | null
  companyId?: string | null
  /** Row state before a mutation. */
  before?: unknown
  /** Row state after a mutation, or the event payload for non-mutation events. */
  after?: unknown
  ipAddress?: string | null
  userAgent?: string | null
}

// ── Internals ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keys whose values must never reach the audit log in cleartext. */
const REDACT_KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)/i

const MAX_JSON_CHARS = 32_000

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Deep-copy a value with sensitive keys masked. Applied to every JSONB payload
 * — tool arguments and admin request bodies routinely carry credentials.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max depth]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

/** Serialize to a JSONB-safe string, redacted and size-capped. Never throws. */
function toJsonb(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    const serialized = JSON.stringify(redact(value))
    if (!serialized) return null
    if (serialized.length > MAX_JSON_CHARS) {
      return JSON.stringify({
        truncated: true,
        original_chars: serialized.length,
        preview: serialized.slice(0, 2000),
      })
    }
    return serialized
  } catch {
    return JSON.stringify({ error: 'unserializable payload' })
  }
}

/** Client IP from the proxy headers Nginx Proxy Manager sets. Never throws. */
export function getClientIp(c: Context): string | null {
  try {
    return (
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      null
    )
  } catch {
    return null
  }
}

function getUserAgent(c: Context): string | null {
  try {
    return truncate(c.req.header('user-agent') ?? null, 500)
  } catch {
    return null
  }
}

/** `GET /api/finance/pl` — the attempted resource, for denial records. */
export function describeRoute(c: Context): string | null {
  try {
    return `${c.req.method} ${c.req.path}`
  } catch {
    return null
  }
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * Append one row to audit_logs. Never throws, never rejects.
 *
 * actor_id / actor_role fall back to the AsyncLocalStorage actor context
 * established once in requireAuth, so most callers only pass the event itself.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  // No database configured (unit tests) — nothing to write to.
  if (!process.env.DATABASE_URL) return

  try {
    const actor = getActorContext()

    const actorId   = asUuid(entry.actorId ?? actor?.userId ?? null)
    const actorRole = entry.actorRole ?? actor?.role ?? null
    const companyId = asUuid(entry.companyId ?? null)

    await query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, company_id, action, resource_type, resource_id,
          before_json, after_json, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        actorId,
        truncate(actorRole, 64),
        companyId,
        entry.action,
        truncate(entry.resourceType ?? null, 128),
        truncate(entry.resourceId ?? null, 512),
        toJsonb(entry.before),
        toJsonb(entry.after),
        truncate(entry.ipAddress ?? null, 128),
        truncate(entry.userAgent ?? null, 500),
      ]
    )
  } catch (err) {
    // Deliberately swallowed — see failure policy at the top of this file.
    console.error('[audit] write failed for action', entry.action, err)
  }
}

/**
 * writeAuditLog with actor, company, IP and user-agent pulled off the request.
 *
 * Safe to call before requireAuth has run (auth failures) — every context read
 * is guarded. company_id defaults to the request's active company; pass it
 * explicitly when the audited resource belongs to a different one.
 */
export async function writeAuditLogForRequest(c: Context, entry: AuditLogEntry): Promise<void> {
  let actorId: string | null = null
  let actorRole: string | null = null
  let activeCompanyId: string | null = null

  try {
    actorId         = (c.get('userId') as string | undefined) ?? null
    actorRole       = (c.get('role') as string | undefined) ?? null
    activeCompanyId = (c.get('activeCompanyId') as string | null | undefined) ?? null
  } catch {
    // Mocked or pre-auth context — fall back to whatever the entry carries.
  }

  await writeAuditLog({
    ...entry,
    actorId:   entry.actorId   ?? actorId,
    actorRole: entry.actorRole ?? actorRole,
    companyId: entry.companyId ?? activeCompanyId,
    ipAddress: entry.ipAddress ?? getClientIp(c),
    userAgent: entry.userAgent ?? getUserAgent(c),
  })
}

/**
 * Record an authorization denial (every 403). Shared by require-role,
 * require-module and the inline creator-only guards in routes/settings.ts, so
 * that denials look identical wherever they are raised.
 *
 * Fire-and-forget: the caller returns the 403 immediately rather than waiting
 * on a database round trip.
 */
export function writeAuthzDenial(
  c: Context,
  denial: {
    action: string
    reason: string
    resourceType?: string
    resourceId?: string | null
    detail?: Record<string, unknown>
  }
): void {
  void writeAuditLogForRequest(c, {
    action:       denial.action,
    resourceType: denial.resourceType ?? 'route',
    resourceId:   denial.resourceId ?? describeRoute(c),
    after: {
      reason: denial.reason,
      route:  describeRoute(c),
      ...denial.detail,
    },
  })
}

/**
 * Row-mutation audit event for ordinary CRUD routes that don't have a named
 * AUDIT_ACTIONS constant. action becomes '<table>.<create|update|delete>' —
 * dot-namespaced like every other action in this file, generated instead of
 * hand-enumerated so adding audit coverage to a new table never requires
 * touching AUDIT_ACTIONS. Named constants above are unaffected and still used
 * for auth/admin/export/mcp events.
 */
export async function writeMutationAuditLog(
  c: Context,
  entry: {
    table: string
    op: 'create' | 'update' | 'delete'
    id: string | null | undefined
    before?: unknown
    after?: unknown
    companyId?: string | null
  }
): Promise<void> {
  await writeAuditLogForRequest(c, {
    action:       `${entry.table}.${entry.op}`,
    resourceType: entry.table,
    resourceId:   entry.id,
    companyId:    entry.companyId,
    before:       entry.before,
    after:        entry.after,
  })
}
