'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { queryClient } from '@/app/lib/query-client'
import {
  installApiClient,
  setActiveCompanyId,
  persistActiveCompanyCookie,
} from '@/app/lib/api-client'

export interface Company {
  id: string
  name: string
  invoice_prefix: string
}

interface CompanyContextValue {
  activeCompany: Company | null
  setActiveCompany: (company: Company) => void
  companies: Company[]
}

const CompanyContext = createContext<CompanyContextValue>({
  activeCompany: null,
  setActiveCompany: () => {},
  companies: [],
})

const LAST_CHOICE_KEY = 'cbop_active_company_id'

/**
 * The active company is decided by the SERVER (requireAuth validates the header
 * / cookie against the user's companyIds and hands the result back on
 * /api/session as `initialActiveCompanyId`). This provider only mirrors that
 * decision into the browser so client fetches keep sending it.
 *
 * localStorage keeps the last UI choice purely as a convenience for a bare `/`
 * landing before the cookie is read — it is never an authorization input.
 */
export function CompanyProvider({
  companies,
  initialActiveCompanyId,
  children,
}: {
  companies: Company[]
  initialActiveCompanyId?: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const [activeCompany, setActiveCompanyState] = useState<Company | null>(
    () => companies.find((c) => c.id === initialActiveCompanyId) ?? companies[0] ?? null
  )

  // Attach the header to every same-origin /api/* call, once.
  useEffect(() => {
    installApiClient()
  }, [])

  useEffect(() => {
    const resolved =
      companies.find((c) => c.id === initialActiveCompanyId) ?? companies[0] ?? null
    setActiveCompanyState(resolved)
    setActiveCompanyId(resolved?.id ?? null)
    if (resolved) {
      persistActiveCompanyCookie(resolved.id)
      try {
        localStorage.setItem(LAST_CHOICE_KEY, resolved.id)
      } catch {
        // ignore — private mode / storage disabled
      }
    }
  }, [companies, initialActiveCompanyId])

  const setActiveCompany = useCallback(
    (company: Company) => {
      setActiveCompanyState(company)
      setActiveCompanyId(company.id)
      persistActiveCompanyCookie(company.id)
      try {
        localStorage.setItem(LAST_CHOICE_KEY, company.id)
      } catch {
        // ignore
      }
      // Switching companies changes entitlements server-side, so nothing cached
      // for the previous company may be reused, and the server-rendered layout
      // (sidebar manifest) has to be rebuilt.
      queryClient.invalidateQueries()
      router.refresh()
    },
    [router]
  )

  return (
    <CompanyContext.Provider value={{ activeCompany, setActiveCompany, companies }}>
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return useContext(CompanyContext)
}
