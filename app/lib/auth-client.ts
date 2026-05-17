'use client'
import { createAuthClient } from 'better-auth/client'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'),
  plugins: [magicLinkClient()],
})

export const { signIn, signOut, signUp, useSession } = authClient
