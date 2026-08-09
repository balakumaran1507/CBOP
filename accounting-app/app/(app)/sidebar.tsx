'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCbopSession } from '../lib/session-context'

// Left nav for the authenticated shell. Matches the IA that
// docs/modules/ACCOUNTING_Build_Plan.md's Zoho Books R&D recommends, adapted
// to CBOP's own sidebar space/icon convention (app/components/sidebar.tsx in
// the main repo) rather than copied verbatim - grouped Sales/Purchases here
// since this app is one product, not five spaces like the main CBOP shell.
//
// `ceoOnly` items are hidden entirely for coo/cto rather than shown-disabled -
// per the Slice 2 access-split decision (docs/modules/ACCOUNTING_Build_Plan.md,
// api/lib/modules.ts), day-to-day bookkeeping is business-role, the sensitive
// aggregate views are CEO/creator-only. A coo/cto seeing a greyed-out "Reports"
// link they can never use is worse UX than not showing it.
interface NavItem {
  href: string
  label: string
  ceoOnly?: boolean
}

const NAV: { section: string; items: NavItem[] }[] = [
  { section: '', items: [{ href: '/dashboard', label: 'Dashboard' }] },
  {
    section: 'Sales',
    items: [{ href: '/invoices', label: 'Invoices' }],
  },
  {
    section: 'Purchases',
    items: [
      { href: '/bills', label: 'Bills' },
      { href: '/expenses', label: 'Expenses' },
    ],
  },
  {
    section: 'Banking',
    items: [{ href: '/banking', label: 'Bank & Cash' }],
  },
  {
    section: 'Accountant',
    items: [
      { href: '/journal', label: 'Journal Entries' },
      { href: '/accounts', label: 'Chart of Accounts' },
      { href: '/periods', label: 'Fiscal Periods', ceoOnly: true },
    ],
  },
  {
    section: '',
    items: [{ href: '/reports', label: 'Reports', ceoOnly: true }],
  },
]

export function Sidebar() {
  const session = useCbopSession()
  const pathname = usePathname()
  const isCeo = session.role === 'ceo' || session.role === 'creator'

  return (
    <aside className="w-56 shrink-0 bg-sidebar text-white/90 min-h-[calc(100vh-48px)] py-4">
      {NAV.map((group, gi) => {
        const items = group.items.filter((item) => !item.ceoOnly || isCeo)
        if (items.length === 0) return null
        return (
          <div key={gi} className="mb-5 px-3">
            {group.section && (
              <p className="px-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
                {group.section}
              </p>
            )}
            <nav className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                      active ? 'bg-white/10 text-white font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        )
      })}
    </aside>
  )
}
