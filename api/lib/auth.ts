import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { Pool } from 'pg'
import { sendEmail } from './mailer'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required — refusing to start with no database configured')
}
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required — refusing to start and sign sessions with no configured secret')
}

// better-auth needs a Pool with explicit params - Kysely's postgres driver can't parse connectionString
const dbUrl = new URL(process.env.DATABASE_URL)
const authPool = new Pool({
  host:     dbUrl.hostname,
  port:     parseInt(dbUrl.port || '5432'),
  user:     dbUrl.username,
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
})

export const auth = betterAuth({
  database: authPool,
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
  advanced: {
    // ⚠️  DO NOT touch cookiePrefix or cookies.session_token.name.
    // In better-auth v1.6.25, the live session-token cookie is named
    // `better-auth.session_token` (or `__Secure-better-auth.session_token`
    // on HTTPS). Changing that name — even to something "cleaner" like
    // `cbop_session` — silently invalidates every browser session the moment
    // the server restarts, producing a wall of 401s. The original
    // `session.cookieName` option was a no-op in this version; don't add it
    // back. Leave this block as `{}` and let better-auth use its defaults.
    cookies: {},
    // CBOP Accounting (docs/modules/ACCOUNTING_Build_Plan.md) lives at
    // accounting.etherence.com and needs to read the same session cookie
    // set here at cbop.etherence.com. Both are single-level subdomains of
    // etherence.com (siblings, not nested) - renamed 2026-08-07 from
    // accounting.cbop.etherence.com because Cloudflare's free Universal SSL
    // only covers the apex + one wildcard level (*.etherence.com), not a
    // second level (*.cbop.etherence.com), so that hostname had no valid edge
    // cert. Because the two apps are now siblings rather than parent/child,
    // the cookie domain must be the shared ancestor .etherence.com, not
    // .cbop.etherence.com - this is a deliberately wider scope than originally
    // designed (the session cookie now also reaches any other subdomain under
    // etherence.com, e.g. unrelated projects on the same homeserver/tunnel
    // account). Accepted knowingly in exchange for a working cert on the free
    // plan; revisit if Advanced Certificate Manager is ever purchased instead.
    //
    // Gated behind an env var, off by default: unset, this is a no-op and
    // better-auth scopes the cookie to whatever host baseURL resolves to,
    // exactly as it does today. Only set BETTER_AUTH_COOKIE_DOMAIN once the
    // accounting subdomain is actually live in a given environment - setting
    // it prematurely (e.g. in local dev against localhost) breaks login,
    // since a `.etherence.com` cookie is never sent to `localhost`.
    ...(process.env.BETTER_AUTH_COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: process.env.BETTER_AUTH_COOKIE_DOMAIN,
          },
        }
      : {}),
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003',
  trustedOrigins: [
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'http://cbop.etherence.com',
    'https://cbop.etherence.com',
    // CBOP Accounting subdomain (Slice 3, docs/modules/ACCOUNTING_Build_Plan.md) -
    // hardcoded alongside the main domain above rather than left to
    // BETTER_AUTH_TRUSTED_ORIGINS, since it's a fixed part of this deployment,
    // not an admin-configurable integration endpoint. Renamed 2026-08-07, see
    // the crossSubDomainCookies comment above for why.
    'https://accounting.etherence.com',
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map(s => s.trim())
      : []),
  ],
  plugins: [
    magicLink({
      disableSignUp: true,
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: 'Your CBOP login link',
          text: `Sign in to CBOP\n\nClick the link below to sign in. It expires in 15 minutes.\n\n${url}\n\nIf you didn't request this, ignore this email.`,
          html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your CBOP login link</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f3;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d5dbdb;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #d5dbdb;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#16191f;letter-spacing:-0.5px;">CBOP</p>
              <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Your company. One OS.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#16191f;">Sign in to CBOP</p>
              <p style="margin:0 0 28px;font-size:14px;color:#4b5563;line-height:1.6;">Click the button below to sign in. This link expires in 15 minutes.</p>
              <a href="${url}" style="display:inline-block;padding:10px 24px;background:#0073bb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;">Sign in to CBOP</a>
              <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or copy this link into your browser:<br><span style="color:#0073bb;word-break:break-all;">${url}</span></p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 24px;border-top:1px solid #d5dbdb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">If you didn't request this email, you can safely ignore it. This link will expire automatically.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        })
      },
    }),
  ],
})

export type Session = typeof auth.$Infer.Session
