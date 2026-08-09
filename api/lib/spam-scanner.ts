// Pre-send spam scanner. Scores subject + body + attachments for the elements that
// trip Gmail/Yahoo/SpamAssassin filters. Pure logic - no network, no deps.
//
// Usage:
//   const report = scanEmail({ subject, html, text, attachments, isBulk })
//   if (report.level === 'block') reject; if 'warn' surface to the sender.

export type SpamLevel = 'ok' | 'warn' | 'block'

export interface SpamFinding {
  severity: 'low' | 'medium' | 'high'
  points:   number
  field:    'subject' | 'body' | 'attachment' | 'structure'
  message:  string
}

export interface SpamReport {
  score:    number        // 0–100, higher = spammier
  level:    SpamLevel
  findings: SpamFinding[]
}

export interface ScanInput {
  subject:      string
  html?:        string
  text?:        string
  attachments?: Array<{ filename: string; size?: number; contentType?: string }>
  isBulk?:      boolean   // campaign/list mail - stricter (requires unsubscribe etc.)
  autoFooter?:  boolean   // unsubscribe footer is appended by the send loop - skip that check
}

// Thresholds (tuned conservative so legitimate ops/hiring mail passes clean).
const WARN_AT  = 5
const BLOCK_AT = 12

// Classic spam trigger phrases (subset of the SpamAssassin / marketing canon).
const SPAM_PHRASES = [
  'act now', 'limited time', 'click here', 'buy now', 'order now', 'risk free',
  'risk-free', '100% free', 'free money', 'cash bonus', 'earn money', 'make money',
  'double your', 'guarantee', 'guaranteed', 'no obligation', 'winner', 'you have won',
  'congratulations you', 'claim your', 'prize', 'lottery', 'viagra', 'cialis',
  'weight loss', 'this is not spam', 'not a scam', 'increase sales', 'work from home',
  'be your own boss', 'extra income', 'million dollars', 'urgent response',
  'wire transfer', 'bitcoin', 'crypto investment', 'pre-approved', 'lowest price',
  'no credit check', 'meet singles', 'satisfaction guaranteed', 'while supplies last',
]

const RISKY_EXTENSIONS = [
  '.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.ps1', '.msi', '.jar', '.hta', '.cpl', '.dll', '.lnk', '.reg',
]

const URL_SHORTENERS = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy',
]

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function capsRatio(s: string): number {
  const letters = s.replace(/[^a-zA-Z]/g, '')
  if (letters.length < 10) return 0
  const caps = letters.replace(/[^A-Z]/g, '').length
  return caps / letters.length
}

export function scanEmail(input: ScanInput): SpamReport {
  const findings: SpamFinding[] = []
  const subject = input.subject ?? ''
  const html    = input.html ?? ''
  const bodyText = (input.text && input.text.trim())
    ? input.text
    : (html ? stripHtml(html) : '')
  const haystack = `${subject}\n${bodyText}`.toLowerCase()

  const add = (f: SpamFinding) => findings.push(f)

  // ── SUBJECT ────────────────────────────────────────────────────────────────
  if (!subject.trim()) {
    add({ severity: 'high', points: 6, field: 'subject', message: 'Empty subject line.' })
  }
  if (subject.length > 90) {
    add({ severity: 'low', points: 1, field: 'subject', message: `Subject is long (${subject.length} chars); aim for <70.` })
  }
  if (capsRatio(subject) > 0.6) {
    add({ severity: 'medium', points: 3, field: 'subject', message: 'Subject is mostly UPPERCASE - strong spam signal.' })
  }
  const subjBangs = (subject.match(/[!$]/g) ?? []).length
  if (subjBangs >= 2) {
    add({ severity: 'medium', points: 3, field: 'subject', message: `Subject has ${subjBangs} "!"/"$" characters.` })
  }
  if (/(\b(re|fw|fwd)\b\s*:)/i.test(subject) && !/\bre\b\s*:/i.test(subject.slice(0, 4))) {
    // fake "Re:" injected mid-subject is a classic trick; mild
    add({ severity: 'low', points: 1, field: 'subject', message: 'Subject contains a possibly fake "Re:/Fwd:".' })
  }
  const emojiCount = (subject.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length
  if (emojiCount >= 3) {
    add({ severity: 'low', points: 2, field: 'subject', message: `Subject has ${emojiCount} emoji - Promotions-tab signal.` })
  }

  // ── PHRASES (subject + body) ─────────────────────────────────────────────────
  const hits = SPAM_PHRASES.filter(p => haystack.includes(p))
  if (hits.length > 0) {
    const pts = Math.min(8, hits.length * 2)
    add({
      severity: hits.length >= 3 ? 'high' : 'medium',
      points: pts, field: 'body',
      message: `Spam-trigger phrases: ${hits.slice(0, 6).join(', ')}${hits.length > 6 ? '…' : ''}.`,
    })
  }

  // ── BODY structure ───────────────────────────────────────────────────────────
  if (!bodyText || bodyText.length < 20) {
    add({ severity: 'medium', points: 3, field: 'body', message: 'Body has almost no readable text.' })
  }
  if (html && !(input.text && input.text.trim())) {
    add({ severity: 'medium', points: 3, field: 'structure', message: 'HTML email has no plaintext alternative - looks like spam. Provide a text part.' })
  }

  // Links + image/text balance
  const links = html ? (html.match(/href\s*=\s*["'][^"']+["']/gi) ?? []) : []
  const images = html ? (html.match(/<img\b/gi) ?? []) : []
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length

  if (links.length > 0 && wordCount > 0 && links.length / Math.max(wordCount, 1) > 0.15) {
    add({ severity: 'medium', points: 3, field: 'body', message: `High link-to-text ratio (${links.length} links / ${wordCount} words).` })
  }
  if (images.length > 0 && wordCount < 20) {
    add({ severity: 'high', points: 4, field: 'body', message: 'Image-heavy with little text - classic image-only spam.' })
  }

  // Shortened / raw-IP / shouty URLs
  const urlText = (html + ' ' + bodyText).toLowerCase()
  const shorteners = URL_SHORTENERS.filter(s => urlText.includes(s))
  if (shorteners.length > 0) {
    add({ severity: 'high', points: 4, field: 'body', message: `Link shorteners present (${shorteners.join(', ')}) - use full branded URLs.` })
  }
  if (/https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(urlText)) {
    add({ severity: 'high', points: 4, field: 'body', message: 'Link points at a raw IP address.' })
  }

  // Hidden text (white-on-white / font-size:0) - deceptive content
  if (/font-size\s*:\s*0(px|pt)?/i.test(html) ||
      /color\s*:\s*#fff(fff)?[^a-f0-9]/i.test(html) && /background[^;]*#fff/i.test(html)) {
    add({ severity: 'high', points: 5, field: 'structure', message: 'Possible hidden/invisible text in HTML.' })
  }

  // Body caps + exclamation storms
  if (capsRatio(bodyText) > 0.4 && bodyText.length > 40) {
    add({ severity: 'medium', points: 2, field: 'body', message: 'Body is largely UPPERCASE.' })
  }
  if ((bodyText.match(/!/g) ?? []).length >= 5) {
    add({ severity: 'low', points: 2, field: 'body', message: 'Excessive exclamation marks in body.' })
  }

  // ── BULK requirements ────────────────────────────────────────────────────────
  // Skip the unsubscribe check when autoFooter=true - the send loop appends it
  // automatically after this scan runs, so penalising here is a false positive.
  if (input.isBulk && !input.autoFooter) {
    const hasUnsub = /unsubscribe/i.test(html) || /unsubscribe/i.test(bodyText)
    if (!hasUnsub) {
      add({ severity: 'high', points: 5, field: 'structure', message: 'Bulk email without an unsubscribe link - required by Gmail/Yahoo policy.' })
    }
  }

  // ── ATTACHMENTS ──────────────────────────────────────────────────────────────
  for (const att of input.attachments ?? []) {
    const lower = (att.filename ?? '').toLowerCase()
    const ext = lower.slice(lower.lastIndexOf('.'))
    if (RISKY_EXTENSIONS.includes(ext)) {
      add({ severity: 'high', points: 8, field: 'attachment', message: `Executable/script attachment "${att.filename}" - will be blocked by most mail servers.` })
    }
    if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) {
      add({ severity: 'medium', points: 3, field: 'attachment', message: `Archive attachment "${att.filename}" raises spam score; link to a download instead.` })
    }
    if (att.size && att.size > 10 * 1024 * 1024) {
      add({ severity: 'medium', points: 2, field: 'attachment', message: `Attachment "${att.filename}" is large (${(att.size / 1048576).toFixed(1)} MB).` })
    }
  }

  const score = Math.min(100, findings.reduce((s, f) => s + f.points, 0))
  const level: SpamLevel = score >= BLOCK_AT ? 'block' : score >= WARN_AT ? 'warn' : 'ok'

  // Sort worst-first for display.
  findings.sort((a, b) => b.points - a.points)

  return { score, level, findings }
}
