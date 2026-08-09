'use client'

import { createContext, useContext } from 'react'
import type { CbopSession } from './get-cbop-session'

// Populated once, server-side, by the (app) layout's getCbopSession() call and
// handed down as a plain prop - never re-fetched client-side on every render.
// This is UI convenience only. It is NOT the security boundary: every
// /api/accounting/* route re-checks role/companyIds/module access itself via
// requireAuth + requireModule server-side, exactly like the main CBOP app.
const SessionContext = createContext<CbopSession | null>(null)

export function AccountingSessionProvider({
  session,
  children,
}: {
  session: CbopSession | null
  children: React.ReactNode
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

/** Throws if called outside the (app) route group - every authenticated page has a session. */
export function useCbopSession(): CbopSession {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useCbopSession() called outside AccountingSessionProvider - is this component inside the (app) route group?')
  }
  return session
}
