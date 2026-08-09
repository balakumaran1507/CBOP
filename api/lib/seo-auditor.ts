// Build Unit 3: in-house technical SEO auditor. Plain fetch() + regex-based
// HTML parsing (matches this codebase's existing lightweight-regex approach
// to HTML, see htmlToText() in mailer.ts - no DOM/cheerio dependency added).
// No external API, no OAuth - CBOP's own crawler.

export interface AuditIssue {
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
}

export interface AuditResult {
  score: number
  issues: AuditIssue[]
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_LINKS_CHECKED = 50
const LINK_CHECK_CONCURRENCY = 5

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

function extractTag(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern)
  return m ? m[1].trim() : null
}

function extractAll(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map(m => m[1])
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

async function checkBrokenLinks(html: string, origin: string): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = []
  const hrefs = extractAll(html, /<a\s[^>]*href=["']([^"'#]+)["']/gi)

  const internalLinks = new Set<string>()
  for (const href of hrefs) {
    try {
      const resolved = new URL(href, origin)
      if (resolved.origin === origin) internalLinks.add(resolved.href)
    } catch { /* malformed href, skip */ }
  }

  const linksToCheck = [...internalLinks].slice(0, MAX_LINKS_CHECKED)
  const broken: string[] = []

  for (let i = 0; i < linksToCheck.length; i += LINK_CHECK_CONCURRENCY) {
    const batch = linksToCheck.slice(i, i + LINK_CHECK_CONCURRENCY)
    const results = await Promise.all(batch.map(async (link) => {
      try {
        const res = await fetchWithTimeout(link, { method: 'HEAD' })
        return res.ok || (res.status >= 300 && res.status < 400) ? null : link
      } catch {
        return link
      }
    }))
    broken.push(...results.filter((r): r is string => r !== null))
  }

  if (broken.length > 0) {
    issues.push({
      severity: 'error',
      category: 'links',
      message: `${broken.length} broken internal link${broken.length > 1 ? 's' : ''}: ${broken.slice(0, 5).join(', ')}${broken.length > 5 ? '...' : ''}`,
    })
  }

  return issues
}

export async function auditUrl(url: string): Promise<AuditResult> {
  const issues: AuditIssue[] = []
  const origin = new URL(url).origin

  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    return { score: 0, issues: [{ severity: 'error', category: 'availability', message: `Page returned HTTP ${res.status}` }] }
  }
  const html = await res.text()

  // Title tag
  const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i)
  if (!title) {
    issues.push({ severity: 'error', category: 'meta', message: 'Missing title tag' })
  } else {
    const len = decodeEntities(title).length
    if (len < 10 || len > 60) issues.push({ severity: 'warning', category: 'meta', message: `Title tag is ${len} chars - Google's practical display range is 10-60` })
  }

  // Meta description
  const description = extractTag(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)
    ?? extractTag(html, /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i)
  if (!description) {
    issues.push({ severity: 'error', category: 'meta', message: 'Missing meta description' })
  } else {
    const len = decodeEntities(description).length
    if (len < 50 || len > 160) issues.push({ severity: 'warning', category: 'meta', message: `Meta description is ${len} chars - recommended range is 50-160` })
  }

  // Heading hierarchy
  const h1s = extractAll(html, /<h1[^>]*>/gi)
  if (h1s.length === 0) issues.push({ severity: 'error', category: 'headings', message: 'No H1 found' })
  else if (h1s.length > 1) issues.push({ severity: 'warning', category: 'headings', message: `${h1s.length} H1 tags found - should be exactly one` })

  const headingLevels = extractAll(html, /<h([1-6])[^>]*>/gi).map(Number)
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) {
      issues.push({ severity: 'warning', category: 'headings', message: `Heading level skips from H${headingLevels[i - 1]} to H${headingLevels[i]}` })
      break
    }
  }

  // Image alt text
  const imgTags = extractAll(html, /<img\s[^>]*>/gi)
  const imagesWithoutAlt = imgTags.filter(tag => !/\salt=["'][^"']+["']/i.test(tag)).length
  if (imagesWithoutAlt > 0) issues.push({ severity: 'error', category: 'images', message: `${imagesWithoutAlt} image${imagesWithoutAlt > 1 ? 's' : ''} missing alt text` })

  // Canonical
  if (!/<link\s[^>]*rel=["']canonical["']/i.test(html)) {
    issues.push({ severity: 'warning', category: 'meta', message: 'No canonical link tag' })
  }

  // Open Graph
  const ogTags = ['og:title', 'og:description', 'og:image']
  const missingOg = ogTags.filter(tag => !new RegExp(`<meta\\s+property=["']${tag}["']`, 'i').test(html))
  if (missingOg.length > 0) issues.push({ severity: 'info', category: 'social', message: `Missing Open Graph tags: ${missingOg.join(', ')}` })

  // Viewport (cheap mobile-friendliness proxy, not a replacement for the real Mobile-Friendly Test API)
  if (!/<meta\s+name=["']viewport["']/i.test(html)) {
    issues.push({ severity: 'warning', category: 'mobile', message: 'No viewport meta tag - page likely not mobile-responsive' })
  }

  // robots.txt
  try {
    const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`)
    if (!robotsRes.ok) {
      issues.push({ severity: 'info', category: 'crawling', message: 'No robots.txt found' })
    } else {
      const robotsTxt = await robotsRes.text()
      if (/User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsTxt)) {
        issues.push({ severity: 'warning', category: 'crawling', message: 'robots.txt disallows all crawling (Disallow: /)' })
      }
    }
  } catch {
    issues.push({ severity: 'info', category: 'crawling', message: 'Could not fetch robots.txt' })
  }

  // Broken internal links
  issues.push(...await checkBrokenLinks(html, origin))

  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - errorCount * 15 - warningCount * 5)

  return { score, issues }
}
