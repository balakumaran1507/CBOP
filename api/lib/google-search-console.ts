// Google Search Console API - OAuth2 + Search Analytics/URL Inspection/Sitemaps.
// Official, free, no-scraping data source (see docs/modules/SEO_Build_Plan.md for why this
// matters - Google is actively suing SerpApi over SERP-scraping-adjacent access).
// Degrades gracefully when GOOGLE_OAUTH_CLIENT_ID/SECRET aren't set yet - callers
// check isGoogleOAuthConfigured() before offering the "Connect" button at all.

const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
const REDIRECT_URI  = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'}/api/seo/oauth/callback`

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
]

export function isGoogleOAuthConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET)
}

export function buildAuthUrl(state: string): string {
  if (!isGoogleOAuthConfigured()) throw new Error('Google OAuth not configured - set GOOGLE_OAUTH_CLIENT_ID/SECRET')
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  return res.json() as Promise<TokenResponse>
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`)
  return res.json() as Promise<TokenResponse>
}

async function gscFetch(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Search Console API error (${res.status}): ${await res.text()}`)
  return res.json()
}

export async function listVerifiedSites(accessToken: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const data = await gscFetch(accessToken, '/sites') as { siteEntry?: { siteUrl: string; permissionLevel: string }[] }
  return data.siteEntry ?? []
}

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export async function getSearchAnalytics(accessToken: string, siteUrl: string, opts: {
  startDate: string; endDate: string; dimensions: ('query' | 'page' | 'country' | 'device' | 'date')[]; rowLimit?: number
}): Promise<SearchAnalyticsRow[]> {
  const data = await gscFetch(accessToken, `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({
      startDate: opts.startDate, endDate: opts.endDate, dimensions: opts.dimensions, rowLimit: opts.rowLimit ?? 1000,
    }),
  }) as { rows?: SearchAnalyticsRow[] }
  return data.rows ?? []
}

export async function inspectUrl(accessToken: string, siteUrl: string, pageUrl: string): Promise<{
  coverageState: string; verdict: string; lastCrawlTime?: string
}> {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl }),
  })
  if (!res.ok) throw new Error(`URL Inspection API error (${res.status}): ${await res.text()}`)
  const data = await res.json() as { inspectionResult?: { indexStatusResult?: { coverageState: string; verdict: string; lastCrawlTime?: string } } }
  const r = data.inspectionResult?.indexStatusResult
  return { coverageState: r?.coverageState ?? 'UNKNOWN', verdict: r?.verdict ?? 'UNKNOWN', lastCrawlTime: r?.lastCrawlTime }
}

export async function listSitemaps(accessToken: string, siteUrl: string): Promise<{ path: string; lastSubmitted?: string; isPending?: boolean; errors?: number; warnings?: number }[]> {
  const data = await gscFetch(accessToken, `/sites/${encodeURIComponent(siteUrl)}/sitemaps`) as {
    sitemap?: { path: string; lastSubmitted?: string; isPending?: boolean; errors?: number; warnings?: number }[]
  }
  return data.sitemap ?? []
}

export async function submitSitemap(accessToken: string, siteUrl: string, sitemapUrl: string): Promise<void> {
  await gscFetch(accessToken, `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT' })
}
