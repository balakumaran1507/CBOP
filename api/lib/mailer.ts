import nodemailer, { Transporter } from 'nodemailer'
import { randomUUID } from 'crypto'
import { query } from './db'
import { scanEmail, type SpamReport } from './spam-scanner'

// ── Open/click tracking (campaign sends only - see sendEmail()'s `track` opt) ──

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003'

export function injectTrackingPixel(html: string, token: string): string {
  const pixel = `<img src="${appUrl()}/api/email-track/open/${token}.gif" width="1" height="1" style="display:none" alt="" />`
  return html.includes('</body>') ? html.replace('</body>', `${pixel}</body>`) : html + pixel
}

export function rewriteLinksForTracking(html: string, token: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    if (url.includes('/api/public/unsubscribe')) return match // never wrap the one-click unsubscribe link
    return `href="${appUrl()}/api/email-track/click/${token}?url=${encodeURIComponent(url)}"`
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// CBOP unified outbound email service.
//
//   • Transport: Google Workspace SMTP per company (pluggable - swap to SES later
//     by replacing buildTransport()).
//   • Verified-domain guard: refuses to send AS a domain that isn't authenticated
//     (SPF+DKIM+DMARC). Protects the reputation of every CBOP domain.
//   • Suppression: never re-emails unsubscribed / bounced / complained addresses
//     (opt-in per call via respectSuppression - transactional auth mail opts out).
//   • Spam scan: optional pre-send content check (scanEmail).
//   • Audit: every send is written to email_send_log.
// ═════════════════════════════════════════════════════════════════════════════

// ── Verified sending domains ─────────────────────────────────────────────────
// Source of truth is the email_domains table (migration 014). We cache it and
// fall back to a hardcoded snapshot so sends still work pre-migration.

interface DomainCfg { domain: string; verified: boolean; from_email: string | null; smtp_env: string | null; daily_cap?: number; provider?: string; company_id?: string | null }

const DOMAIN_FALLBACK: Record<string, DomainCfg> = {
  'cybercomctf.com': { domain: 'cybercomctf.com', verified: true,  from_email: 'founders@cybercomctf.com', smtp_env: 'CYBERCOM',  daily_cap: 700 },
  'ouantum.com':     { domain: 'ouantum.com',     verified: true,  from_email: 'founders@ouantum.com',     smtp_env: 'OUANTUM',   daily_cap: 700 },
  'zapsters.in':     { domain: 'zapsters.in',     verified: true,  from_email: 'founders@zapsters.in',     smtp_env: 'ZAPSTERS',  daily_cap: 700 },
  'etherence.com':   { domain: 'etherence.com',   verified: false, from_email: 'founders@etherence.com',   smtp_env: 'ETHERENCE', daily_cap: 700 },
  'attackos.com':    { domain: 'attackos.com',    verified: false, from_email: 'founders@attackos.com',    smtp_env: 'ATTACKOS',  daily_cap: 700 },
}

let domainCache: Map<string, DomainCfg> | null = null
let domainCacheAt = 0
const DOMAIN_TTL = 60_000

async function loadDomains(): Promise<Map<string, DomainCfg>> {
  if (domainCache && Date.now() - domainCacheAt < DOMAIN_TTL) return domainCache
  const map = new Map<string, DomainCfg>(Object.entries(DOMAIN_FALLBACK))
  try {
    const { rows } = await query<DomainCfg>(`SELECT domain, verified, from_email, smtp_env, daily_cap, provider, company_id FROM email_domains`)
    for (const r of rows) map.set(r.domain.toLowerCase(), r)
  } catch {
    try {
      // daily_cap/company_id columns not migrated yet - fall back to the pre-019 shape.
      const { rows } = await query<DomainCfg>(`SELECT domain, verified, from_email, smtp_env FROM email_domains`)
      for (const r of rows) map.set(r.domain.toLowerCase(), { ...r, daily_cap: DOMAIN_FALLBACK[r.domain.toLowerCase()]?.daily_cap })
    } catch { /* table not migrated yet - keep fallback */ }
  }
  domainCache = map
  domainCacheAt = Date.now()
  return map
}

export function domainOf(emailOrFrom: string): string {
  const m = emailOrFrom.match(/<([^>]+)>/)
  const addr = (m ? m[1] : emailOrFrom).trim().toLowerCase()
  return addr.slice(addr.lastIndexOf('@') + 1)
}

/** True if we're allowed to send AS this domain (SPF/DKIM/DMARC in place). */
export async function isDomainVerified(emailOrFrom: string): Promise<boolean> {
  const domains = await loadDomains()
  const cfg = domains.get(domainOf(emailOrFrom))
  return cfg ? cfg.verified : false
}

/**
 * Reverse of resolveFromForCompany(): given an inbox/domain (e.g. a hiring
 * inbox address like careers@cybercomctf.com), returns the owning company_id
 * from email_domains, or null if that domain isn't registered. Single shared
 * source for domain -> company routing - callers should use this instead of
 * keeping their own hardcoded domain -> company_id map (see api/routes/internal.ts).
 */
export async function companyIdForDomain(emailOrDomain: string): Promise<string | null> {
  const domain = emailOrDomain.includes('@') ? domainOf(emailOrDomain) : emailOrDomain.toLowerCase()
  const domains = await loadDomains()
  return domains.get(domain)?.company_id ?? null
}

/**
 * Resolves "the right From address for this company" from email_domains
 * (migration 029 linked each row to its owning company). Prefers a verified
 * domain if the company somehow has more than one row. Returns null if the
 * company has no configured domain - callers should fall back to the
 * generic transactional sender in that case, not silently guess.
 */
export async function resolveFromForCompany(companyId: string | null | undefined, companyName?: string): Promise<string | null> {
  if (!companyId) return null
  const domains = await loadDomains()
  const matches = [...domains.values()].filter(d => d.company_id === companyId)
  const best = matches.find(d => d.verified) ?? matches[0]
  if (!best?.from_email) return null
  return companyName ? `${companyName} <${best.from_email}>` : best.from_email
}

export class UnverifiedDomainError extends Error {
  constructor(public domain: string) {
    super(`Refusing to send as "${domain}" - domain is not verified (SPF/DKIM/DMARC not in place). ` +
          `Set up Google Workspace + DNS and mark it verified in email_domains. See docs/modules/EMAIL_DELIVERABILITY.md.`)
    this.name = 'UnverifiedDomainError'
  }
}

// ── Suppression ──────────────────────────────────────────────────────────────
export async function isSuppressed(email: string, companyId?: string | null): Promise<boolean> {
  try {
    const { rows } = await query(
      `SELECT 1 FROM email_suppression
       WHERE email = $1 AND (company_id IS NULL OR company_id = $2) LIMIT 1`,
      [email.toLowerCase(), companyId ?? null]
    )
    if (rows.length > 0) return true
    // legacy table
    const { rows: legacy } = await query(`SELECT 1 FROM email_unsubscribes WHERE email = $1 LIMIT 1`, [email.toLowerCase()])
    return legacy.length > 0
  } catch { return false }
}

export async function suppress(email: string, reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual', companyId?: string | null, detail?: string): Promise<void> {
  await query(
    `INSERT INTO email_suppression (email, company_id, reason, detail)
     VALUES ($1, $2, $3, $4) ON CONFLICT (email, company_id) DO NOTHING`,
    [email.toLowerCase(), companyId ?? null, reason, detail ?? null]
  )
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function logSend(row: {
  companyId?: string | null; kind: string; to: string; from: string;
  subject: string; status: string; spamScore?: number | null; reason?: string | null; messageId?: string | null
  designId?: string | null; attachmentRefs?: unknown[]; renderedHtml?: string | null; trackingToken?: string | null
}): Promise<void> {
  try {
    await query(
      `INSERT INTO email_send_log (company_id, kind, to_email, from_email, subject, status, spam_score, reason, message_id, design_id, attachment_refs, rendered_html, tracking_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [row.companyId ?? null, row.kind, row.to, row.from, row.subject?.slice(0, 300) ?? '',
       row.status, row.spamScore ?? null, row.reason?.slice(0, 300) ?? null, row.messageId ?? null,
       row.designId ?? null, JSON.stringify(row.attachmentRefs ?? []), row.renderedHtml ?? null, row.trackingToken ?? null]
    )
  } catch { /* logging must never break a send */ }
}

// ── Daily send cap - per sending domain, see migrations/019_email_domain_warmup.sql ──
// Old behavior was a single flat DAILY_CAP = 1000 for every domain regardless of age
// or reputation. That's what let a brand-new zapsters.in Workspace mailbox push 900+
// sends in one day and get hit with a Google abuse lockout. Cap is now sourced from
// email_domains.daily_cap (default 50 - see DOMAIN_FALLBACK above) and must be raised
// by hand as a domain proves out a clean send history.
export const DAILY_CAP_FALLBACK = 50

export async function dailyCapFor(fromEmail: string): Promise<number> {
  const domains = await loadDomains()
  const cfg = domains.get(domainOf(fromEmail))
  return cfg?.daily_cap ?? DAILY_CAP_FALLBACK
}

export async function todaySentCount(fromEmail: string): Promise<number> {
  try {
    const { rows: [r] } = await query(
      `SELECT count(*)::int AS n FROM email_send_log
       WHERE from_email = $1 AND status = 'sent'
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
      [fromEmail.toLowerCase()]
    )
    return r?.n ?? 0
  } catch { return 0 }
}

export async function isAtDailyCap(fromEmail: string): Promise<boolean> {
  const [sent, cap] = await Promise.all([todaySentCount(fromEmail), dailyCapFor(fromEmail)])
  return sent >= cap
}

// ── Transport (pluggable seam - Google Workspace per-mailbox, or shared SES) ──
// .env has grown two different naming conventions for per-domain SMTP creds
// (SMTP_USER_<ENV> for cybercomctf/etherence/attackos, SMTP_<ENV>_USER for
// zapsters/ouantum, plus a legacy SMTP_USER_QUANTUM typo predating the
// OUANTUM rename) - getCampaignTransporter() already tries all of these;
// this must too, or a domain resolves the right From address but then
// authenticates as the wrong mailbox (or the generic default) to send it.
function smtpCreds(smtpEnv: string | null): { user: string; pass: string } {
  if (!smtpEnv) return { user: process.env.SMTP_USER || '', pass: (process.env.SMTP_PASS || '').replace(/\s/g, '') }
  const user =
    process.env[`SMTP_USER_${smtpEnv}`] ||
    process.env[`SMTP_${smtpEnv}_USER`] ||
    (smtpEnv === 'OUANTUM' ? process.env.SMTP_USER_QUANTUM : undefined) ||
    process.env.SMTP_USER || ''
  const pass = (
    process.env[`SMTP_PASS_${smtpEnv}`] ||
    process.env[`SMTP_${smtpEnv}_PASS`] ||
    (smtpEnv === 'OUANTUM' ? process.env.SMTP_PASS_QUANTUM : undefined) ||
    process.env.SMTP_PASS || ''
  ).replace(/\s/g, '')
  return { user, pass }
}

const transporterCache = new Map<string, Transporter>()
function buildTransport(user: string, pass: string): Transporter {
  if (!transporterCache.has(user)) {
    transporterCache.set(user, nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth:   { user, pass },
    }))
  }
  return transporterCache.get(user)!
}

// SES SMTP credentials are account/region-wide (generated once in the SES console under
// "SMTP settings" - NOT your AWS IAM access key). One SES SMTP user can send as any
// identity verified in that AWS account/region, so unlike Workspace there's no per-domain
// credential pair to look up - every domain with provider='ses' shares this one transport.
// See docs/modules/EMAIL_DELIVERABILITY.md §7 for domain verification + sandbox/production steps.
let sesTransport: Transporter | null = null
function buildSesTransport(): Transporter {
  if (!sesTransport) {
    sesTransport = nodemailer.createTransport({
      host:   process.env.SES_SMTP_HOST || '',
      port:   Number(process.env.SES_SMTP_PORT) || 587,
      secure: false,
      auth:   { user: process.env.SES_SMTP_USER || '', pass: process.env.SES_SMTP_PASS || '' },
    })
  }
  return sesTransport
}

// Resolve the real From address out of a "Name <addr>" string or a bare address.
// Needed because the SMTP *login* (SES SMTP username, or a Workspace mailbox) is not
// always the same string as the From address - daily-cap accounting and email_send_log
// must always key off the From address, never the transport credential.
function addressOf(emailOrFrom: string): string {
  const m = emailOrFrom.match(/<([^>]+)>/)
  return (m ? m[1] : emailOrFrom).trim().toLowerCase()
}

/** Pick the right transport for a resolved domain config - Workspace mailbox, shared SES,
 *  or the default transactional transporter if the domain has no dedicated creds. */
function transportFor(cfg: DomainCfg | undefined, mailboxUser: string, mailboxPass: string): Transporter {
  if (cfg?.provider === 'ses') return buildSesTransport()
  if (mailboxUser && mailboxPass) return buildTransport(mailboxUser, mailboxPass)
  return transporter
}

// Default transactional transporter (auth, password resets, system mail).
const transporter = buildTransport(
  process.env.SMTP_USER || '',
  (process.env.SMTP_PASS || '').replace(/\s/g, '')
)

// Auto-derive a plaintext part from HTML when none is supplied (multipart hygiene).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SendEmailAttachment { filename: string; content: Buffer; contentType?: string }

interface SendEmailOptions {
  to:           string
  subject:      string
  text?:        string
  html:         string
  attachments?: SendEmailAttachment[]
  // unified-service options (all optional, defaults preserve old behavior):
  from?:               string          // override sender; defaults to SMTP_FROM
  companyId?:          string | null
  kind?:               string          // audit category: transactional|hiring|document|auth
  enforceVerified?:    boolean         // block send if sender domain unverified (default true)
  respectSuppression?: boolean         // skip suppressed recipients (default false - transactional)
  scanContent?:        boolean         // run spam scan; block on level 'block' (default false)
  designId?:           string | null  // Email Studio design this send was rendered from, if any
  attachmentRefs?:     unknown[]       // e.g. [{ type: 'document_generated', id }] - audit context for attachments
  track?:              boolean         // open/click tracking pixel + link rewriting (default: only for kind === 'campaign')
}

export interface SendResult { ok: boolean; status: 'sent' | 'blocked' | 'suppressed' | 'failed'; reason?: string; spam?: SpamReport; messageId?: string }

export async function sendEmail(opts: SendEmailOptions): Promise<SendResult> {
  const {
    to, subject, html, attachments, companyId = null,
    kind = 'transactional', enforceVerified = true, respectSuppression = false, scanContent = false,
    designId = null, attachmentRefs = [],
  } = opts
  const from = opts.from || process.env.SMTP_FROM || `CBOP Platform <${process.env.SMTP_USER}>`
  const text = (opts.text && opts.text.trim()) ? opts.text : htmlToText(html)

  const shouldTrack   = opts.track ?? (kind === 'campaign')
  const trackingToken = shouldTrack ? randomUUID() : null
  const trackedHtml   = trackingToken ? injectTrackingPixel(rewriteLinksForTracking(html, trackingToken), trackingToken) : html

  const logCtx = { companyId, kind, to, from, subject, designId, attachmentRefs, renderedHtml: trackedHtml, trackingToken }

  // 1. Verified-domain guard
  if (enforceVerified && !(await isDomainVerified(from))) {
    const d = domainOf(from)
    await logSend({ ...logCtx, status: 'blocked', reason: `unverified domain ${d}` })
    return { ok: false, status: 'blocked', reason: `Domain "${d}" is not verified for sending. See docs/modules/EMAIL_DELIVERABILITY.md.` }
  }

  // 2. Suppression
  if (respectSuppression && await isSuppressed(to, companyId)) {
    await logSend({ ...logCtx, status: 'suppressed', reason: 'on suppression list' })
    return { ok: false, status: 'suppressed', reason: 'Recipient is unsubscribed/suppressed.' }
  }

  // 3. Spam scan
  let spam: SpamReport | undefined
  if (scanContent) {
    spam = scanEmail({ subject, html, text, attachments, isBulk: kind === 'campaign' })
    if (spam.level === 'block') {
      await logSend({ ...logCtx, status: 'blocked', spamScore: spam.score, reason: 'spam scan block' })
      return { ok: false, status: 'blocked', reason: `Blocked by spam scan (score ${spam.score}).`, spam }
    }
  }

  // 4. Send (route through the domain's own SMTP creds for DKIM alignment - or shared SES)
  const domains = await loadDomains()
  const cfg = domains.get(domainOf(from))
  const { user, pass } = smtpCreds(cfg?.smtp_env ?? null)
  const tx = transportFor(cfg, user, pass)

  try {
    const info = await tx.sendMail({ from, to, subject, text, html: trackedHtml, attachments })
    await logSend({ ...logCtx, status: 'sent', spamScore: spam?.score ?? null, messageId: info.messageId })
    return { ok: true, status: 'sent', spam, messageId: info.messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logSend({ ...logCtx, status: 'failed', spamScore: spam?.score ?? null, reason: msg })
    return { ok: false, status: 'failed', reason: msg, spam }
  }
}

// ── Campaign transporter - per-company sender routing ──────────────────────
// Returns the transporter + From for a company's verified sending domain.
// Driven entirely by email_domains (migration 029 links each row to its
// owning company_id) - adding a company's SMTP creds to .env and a verified
// row to email_domains is enough; nothing here needs a code change per company.

export async function getCampaignTransporter(companyId: string | null | undefined, companyName?: string): Promise<{
  transporter: Transporter; from: string; senderEmail: string
}> {
  if (companyId) {
    const domains = await loadDomains()
    const matches = [...domains.values()].filter(d => d.company_id === companyId)
    const cfg = matches.find(d => d.verified) ?? matches[0]
    if (cfg?.from_email && cfg.smtp_env) {
      // Prefer the dedicated *_USER/*_PASS pair, fall back to legacy SMTP_<NAME>_*.
      const user =
        process.env[`SMTP_USER_${cfg.smtp_env}`] ||
        process.env[`SMTP_${cfg.smtp_env}_USER`] ||
        process.env.SMTP_USER || ''
      const pass = (
        process.env[`SMTP_PASS_${cfg.smtp_env}`] ||
        process.env[`SMTP_${cfg.smtp_env}_PASS`] ||
        process.env.SMTP_PASS || ''
      ).replace(/\s/g, '')
      // senderEmail must always be the real From address, never the SMTP login - those
      // happen to be the same string for Workspace mailboxes, but an SES SMTP username
      // (e.g. "AKIA...") is not an email address, and daily-cap accounting / email_send_log
      // are keyed off the From address regardless of which provider sent it.
      const from = companyName ? `${companyName} <${cfg.from_email}>` : cfg.from_email
      return { transporter: transportFor(cfg, user, pass), from, senderEmail: cfg.from_email }
    }
  }
  // default → primary transactional sender (no company match, or company has
  // no verified email_domains row yet)
  const user = process.env.SMTP_USER ?? ''
  const pass = (process.env.SMTP_PASS ?? '').replace(/\s/g, '')
  return {
    transporter: buildTransport(user, pass),
    from: process.env.SMTP_FROM ?? `CBOP <${user}>`,
    senderEmail: user,
  }
}
