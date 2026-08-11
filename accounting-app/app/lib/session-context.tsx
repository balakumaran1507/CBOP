'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import type { CbopSession, CbopCompany } from './get-cbop-session'

// Extends CbopSession so all existing page code (session.role, session.userId etc.)
// continues to work. The only overrides are activeCompanyId (now switchable client-side)
// and setActiveCompanyId (new).
interface SessionContextValue extends CbopSession {
  // Overrides the server-resolved activeCompanyId with the client-selected one
  activeCompanyId: string | null
  activeCompany: CbopCompany | null
  setActiveCompanyId: (id: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

const STORAGE_KEY = 'cbop_acct_active_company'

function resolveInitialCompany(session: CbopSession): string | null {
  // Prefer what the user last chose (stored in localStorage) if it's still valid
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && session.companies.some(c => c.id === stored)) return stored
    } catch { /* ignore */ }
  }
  // Fall back to what CBOP resolved server-side
  return session.activeCompanyId ?? session.companies[0]?.id ?? null
}

export function AccountingSessionProvider({
  session,
  children,
}: {
  session: CbopSession
  children: React.ReactNode
}) {
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(
    () => resolveInitialCompany(session)
  )

  const setActiveCompanyId = useCallback((id: string) => {
    setActiveCompanyIdState(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }, [])

  const activeCompany = session.companies.find(c => c.id === activeCompanyId) ?? null

  const value: SessionContextValue = {
    // Spread all CbopSession fields so existing page code works unchanged
    ...session,
    // Override activeCompanyId with the client-switchable version
    activeCompanyId,
    activeCompany,
    setActiveCompanyId,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Throws if called outside the (app) route group. */
export function useCbopSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useCbopSession() called outside AccountingSessionProvider')
  return ctx
}
