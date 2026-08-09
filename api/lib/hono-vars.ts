// Augments Hono's ContextVariableMap so c.get('userId') etc. are typed
// Import this in any file that calls c.get() on auth-injected variables.
import 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    role: string
    companyIds: string[]
    /**
     * The company this request is scoped to — the one the topbar switcher shows
     * as active. Resolved and validated against companyIds in requireAuth
     * (X-Active-Company-Id header → cbop_active_company_id cookie → first
     * company). Null only when the user belongs to no company at all.
     */
    activeCompanyId: string | null
    /** Module keys that are enabled for the ACTIVE company (company toggle). */
    enabledModules: string[]
    /** Module keys this user's company_role is permitted to access (role permission). */
    allowedModules: string[]
  }
}

export {}
