// Shared token-refresh helper for anything that calls Search Console/GA4 on
// behalf of a stored seo_site_connections row. Centralized here so Build Unit 2
// (SEO Monitoring dashboard) and any future SEO route reuse the same refresh
// logic instead of duplicating it.

import { query } from './db'
import { refreshAccessToken } from './google-search-console'

interface Connection {
  id: string
  company_id: string
  site_url: string
  ga4_property_id: string | null
  google_access_token: string
  google_refresh_token: string
  token_expires_at: string
}

export async function getConnection(id: string, companyIds: string[]): Promise<Connection | null> {
  const result = await query(
    `SELECT * FROM seo_site_connections WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  return result.rows[0] ?? null
}

// Returns a valid access token, refreshing and persisting a new one first if
// the stored token has expired (with a 60s safety margin).
export async function getValidAccessToken(conn: Connection): Promise<string> {
  const expiresAt = new Date(conn.token_expires_at).getTime()
  if (expiresAt - Date.now() > 60_000) return conn.google_access_token

  const refreshed = await refreshAccessToken(conn.google_refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000)

  await query(
    `UPDATE seo_site_connections SET google_access_token = $1, token_expires_at = $2 WHERE id = $3`,
    [refreshed.access_token, newExpiresAt, conn.id]
  )

  return refreshed.access_token
}
