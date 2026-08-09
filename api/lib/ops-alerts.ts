// ═════════════════════════════════════════════════════════════════════════════
// Per-company "who gets ops alerts" lookup.
//
// Replaces the hardcoded personal identifiers that used to live in route code
// (scale-up plan IF-9):
//   • ALERT_TELEGRAM_ID = '6316112708' — module-level const duplicated in
//     api/routes/documents.ts and api/routes/email-campaigns.ts, paging one
//     specific human whenever *any* company's batch/campaign event fired.
//   • team_lead_email: 'nabeelah@etherence.com' — api/routes/templates.ts
//
// Source of truth is now companies.ops_alert_telegram_id / ops_alert_email
// (migration 059). Both columns are nullable; NULL falls back to the platform
// default (OPS_ALERT_TELEGRAM_ID / OPS_ALERT_EMAIL env vars, then the built-in
// constants below), so nothing regresses for companies that never set one and
// a new tenant works without any code edit.
//
// Lookups are per-event (batch finished, campaign auto-paused, template
// preview) — a handful of queries a day — so there is deliberately no cache
// here, unlike company-brand.ts whose callers are synchronous hot-path
// template builders.
// ═════════════════════════════════════════════════════════════════════════════

import { query } from './db'

export interface OpsAlertTargets {
  /** Telegram chat id to notify for operational events. Never empty. */
  telegramId: string
  /** Ops / team-lead email address for this company. Never empty. */
  email: string
}

// Built-in fallbacks — the values these settings replaced. Kept so behaviour is
// unchanged for a company whose columns are NULL (and before migration 059 is
// applied). Override per deployment with the env vars; override per company
// with the DB columns.
const PLATFORM_FALLBACK_TELEGRAM_ID = '6316112708'
const PLATFORM_FALLBACK_EMAIL       = 'nabeelah@etherence.com'

/** Platform-wide default telegram chat id for ops alerts. */
export function defaultOpsAlertTelegramId(): string {
  return process.env.OPS_ALERT_TELEGRAM_ID || PLATFORM_FALLBACK_TELEGRAM_ID
}

/** Platform-wide default ops/team-lead email. */
export function defaultOpsAlertEmail(): string {
  return process.env.OPS_ALERT_EMAIL || PLATFORM_FALLBACK_EMAIL
}

/**
 * Resolve both ops alert targets for a company, falling back to the platform
 * defaults when the company row is missing, the columns are NULL, or the
 * migration has not been applied yet. Never throws — an alert lookup must not
 * take down the batch/campaign loop that is calling it.
 */
export async function getOpsAlertTargets(companyId?: string | null): Promise<OpsAlertTargets> {
  let row: { ops_alert_telegram_id: string | null; ops_alert_email: string | null } | undefined

  if (companyId) {
    try {
      const res = await query<{ ops_alert_telegram_id: string | null; ops_alert_email: string | null }>(
        `SELECT ops_alert_telegram_id, ops_alert_email FROM companies WHERE id = $1`,
        [companyId]
      )
      row = res.rows[0]
    } catch (err) {
      // Columns not migrated yet, or DB unreachable — use the defaults rather
      // than dropping the alert entirely.
      console.error('[ops-alerts] lookup failed, using platform defaults:', err)
    }
  }

  return {
    telegramId: row?.ops_alert_telegram_id || defaultOpsAlertTelegramId(),
    email:      row?.ops_alert_email       || defaultOpsAlertEmail(),
  }
}

/** Telegram chat id that should receive ops alerts for this company. */
export async function getOpsAlertTelegramId(companyId?: string | null): Promise<string> {
  return (await getOpsAlertTargets(companyId)).telegramId
}

/** Ops / team-lead email address for this company. */
export async function getOpsAlertEmail(companyId?: string | null): Promise<string> {
  return (await getOpsAlertTargets(companyId)).email
}
