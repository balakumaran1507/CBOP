// LinkedIn Posts API - OAuth2 (member or organization author) + publish.
// Two independent access paths, see docs/modules/SOCIAL_Build_Plan.md's "Social Media
// Manager" section:
//   - member:       w_member_social, self-serve, no partner review
//   - organization: w_organization_social, gated behind Community Management
//                    API Standard Tier approval - callers check
//                    isLinkedInOrgReady() before offering that connect option
// Degrades gracefully when LINKEDIN_CLIENT_ID/SECRET aren't set - same pattern
// as api/lib/google-search-console.ts.

const CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID || ''
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || ''
const REDIRECT_URI  = process.env.LINKEDIN_REDIRECT_URI ||
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'}/api/social/linkedin/callback`

// LinkedIn versions its REST API by calendar month - bump periodically.
const LINKEDIN_API_VERSION = '202601'

export type LinkedInConnectionType = 'member' | 'organization'

const SCOPES: Record<LinkedInConnectionType, string[]> = {
  member:       ['openid', 'profile', 'w_member_social'],
  organization: ['w_organization_social'],
}

export function isLinkedInConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET)
}

export function buildAuthUrl(state: string, connectionType: LinkedInConnectionType): string {
  if (!isLinkedInConfigured()) throw new Error('LinkedIn OAuth not configured - set LINKEDIN_CLIENT_ID/SECRET')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES[connectionType].join(' '),
    state,
  })
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  // LinkedIn only issues refresh_token to apps with the separate "Programmatic
  // Refresh Tokens" grant - self-serve member auth does not get one, so a
  // Path A connection needs manual reconnect roughly every 60 days.
  refresh_token?: string
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${await res.text()}`)
  return res.json() as Promise<TokenResponse>
}

export interface LinkedInMemberInfo {
  personUrn: string
  name: string
}

// OpenID Connect userinfo - requires the `openid profile` scopes granted above.
export async function getMemberInfo(accessToken: string): Promise<LinkedInMemberInfo> {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${await res.text()}`)
  const data = await res.json() as { sub: string; name: string }
  return { personUrn: `urn:li:person:${data.sub}`, name: data.name }
}

export interface CreatePostResult {
  postUrn: string
}

// Publishes a text post, optionally with a link (article) attachment. Image/
// video attachments need LinkedIn's separate 3-step upload-register flow -
// not implemented here, out of scope for the first publish loop.
export async function createLinkedInPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  linkUrl?: string,
): Promise<CreatePostResult> {
  const body: Record<string, unknown> = {
    author: authorUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  if (linkUrl) {
    body.content = { article: { source: linkUrl } }
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`LinkedIn post failed (${res.status}): ${await res.text()}`)

  const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || ''
  return { postUrn }
}
