import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { pool } from './db'
import { sendEmail } from './mailer'

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  session: {
    cookieName: 'cbop_session',
    expiresIn: 60 * 60 * 24 * 7,
  },
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-prod',
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003',
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003',
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
