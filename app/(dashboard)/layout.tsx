import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Topbar } from '@/app/components/topbar'
import { Sidebar } from '@/app/components/sidebar'
import { CompanyProvider } from '@/app/lib/company-context'
import { CommandPalette } from '@/app/components/command-palette'
import type { NavManifestGroup } from '@/api/lib/modules'
import type { Company } from '@/app/lib/company-context'

interface SessionPayload {
  userId: string
  name: string | null
  email: string | null
  role: string
  companyIds: string[]
  companies: Company[]
  /** Server-resolved active company — the one requireAuth scoped this request to. */
  activeCompanyId: string | null
  /** Sidebar manifest, already filtered by role + active company's modules. */
  nav: NavManifestGroup[]
}

async function getSessionUser(): Promise<SessionPayload | null> {
  const cookieStore = cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'}/api/session`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as SessionPayload
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <CompanyProvider
      companies={user.companies ?? []}
      initialActiveCompanyId={user.activeCompanyId ?? null}
    >
      <div className="flex flex-col" style={{ height: '100vh', overflow: 'hidden' }}>
        <Topbar
          role={user.role}
          companies={user.companies ?? []}
          name={user.name ?? ''}
          email={user.email ?? ''}
        />
        <div className="flex flex-1" style={{ minHeight: 0 }}>
          {/* Nav comes from the module registry via /api/session — see IF-5 */}
          <Sidebar nav={user.nav ?? []} />
          <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette role={user.role} />
    </CompanyProvider>
  )
}
