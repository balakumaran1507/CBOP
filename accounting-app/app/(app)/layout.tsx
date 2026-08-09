import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCbopSession, hasAccountingAccess } from '../lib/get-cbop-session'
import { Providers } from '../providers'
import { Topbar } from './topbar'
import { Sidebar } from './sidebar'

// Every route under (app) is authenticated. This layout is the real
// verification boundary for the UI (not the security boundary - every
// /api/accounting/* route re-checks server-side regardless, see
// api/routes/accounting.ts in the main repo). Two failure modes, handled
// differently on purpose:
//   - no session at all (cookie missing/invalid)              -> bounce to landing
//   - real CBOP session, but no access to the accounting module -> explain why,
//     don't just redirect silently (a COO/CTO whose company has accounting
//     disabled should see THAT, not a confusing loop back to "Continue with CBOP")
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')
  const session = await getCbopSession(cookieHeader)

  if (!session) redirect('/')

  if (!hasAccountingAccess(session)) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <p className="font-display font-bold text-lg text-text1">Accounting isn&apos;t enabled</p>
          <p className="mt-2 text-sm text-text2">
            Signed in as {session.email}, but the Accounting module isn&apos;t enabled for your
            company or role. Ask a CEO/creator on your CBOP account to enable it under Settings.
          </p>
          <a href="https://cbop.etherence.com/dashboard" className="mt-6 inline-block text-sm text-blue">
            Back to CBOP
          </a>
        </div>
      </main>
    )
  }

  return (
    <Providers session={session}>
      <div className="min-h-screen flex flex-col">
        <Topbar />
        <div className="flex flex-1">
          <Sidebar />
          <div className="flex-1 bg-bg min-w-0">{children}</div>
        </div>
      </div>
    </Providers>
  )
}
