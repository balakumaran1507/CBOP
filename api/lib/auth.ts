import { betterAuth } from 'better-auth'
import { pool } from './db'

export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    cookieName: 'cbop_session',
    expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
  },
  secret: process.env.BETTER_AUTH_SECRET || '',
  // Additional configuration will be added in Slice 1
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.User
