'use client'

import { useCbopSession } from '../lib/session-context'

// Deliberately minimal for Slice 3 - proves the SSO/session plumbing end to
// end (active company, user, role all come from the shared CBOP session, not
// re-derived here). Company switching itself (the actual dropdown, wiring the
// X-Active-Company-Id header used everywhere else) is Slice 4 scope, since it
// needs the transactional UI to switch. NOTE for whoever builds that: the
// cbop_active_company_id cookie the main app writes is plain-origin, not
// necessarily domain-scoped - sending X-Active-Company-Id explicitly on every
// cbopFetch() call (see api-client.ts) rather than relying on that cookie is
// the robust path here, since this app is a different origin from it.
export function Topbar() {
  const session = useCbopSession()
  const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId)

  return (
    <header className="h-12 bg-topbar text-white flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <span className="font-display font-bold text-sm tracking-tight">CBOP Accounting</span>
        {activeCompany && (
          <span className="text-xs text-white/60 font-mono">{activeCompany.name}</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-white/80">
        <span>{session.name} · {session.role}</span>
        <a href="https://cbop.etherence.com/dashboard" className="hover:text-white">Back to CBOP</a>
      </div>
    </header>
  )
}
