import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Topbar } from '@/app/components/topbar'
import { Sidebar } from '@/app/components/sidebar'

async function getSessionUser() {
  const cookieStore = cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'}/api/session`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col" style={{ height: '100vh', overflow: 'hidden' }}>
      <Topbar role={user.role} companies={user.companies} name={user.name} />
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <Sidebar role={user.role} />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
