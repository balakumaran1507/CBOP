import { betterAuth } from 'better-auth'
import { pool } from './db'

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
})

export type Session = typeof auth.$Infer.Session
