'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  icon: string
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  ceo: [
    { label: 'Home', href: '/dashboard', icon: '⌂' },
    { label: 'Sales', href: '/sales', icon: '◈' },
    { label: 'Work', href: '/work', icon: '◉' },
    { label: 'Templates', href: '/templates', icon: '◫' },
    { label: 'CEO Panel', href: '/ceo', icon: '◆' },
    { label: 'Settings', href: '/settings', icon: '⚙' },
  ],
  coo: [
    { label: 'Home', href: '/dashboard', icon: '⌂' },
    { label: 'Sales', href: '/sales', icon: '◈' },
    { label: 'Work', href: '/work', icon: '◉' },
    { label: 'Templates', href: '/templates', icon: '◫' },
    { label: 'Settings', href: '/settings', icon: '⚙' },
  ],
  cto: [
    { label: 'Home', href: '/dashboard', icon: '⌂' },
    { label: 'Work', href: '/work', icon: '◉' },
  ],
}

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname()
  const items = NAV_BY_ROLE[role] || NAV_BY_ROLE.cto

  return (
    <nav
      className="flex flex-col flex-shrink-0"
      style={{ width: '240px', backgroundColor: 'var(--sidebar)', minHeight: 0 }}
    >
      <ul className="py-2">
        {items.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                style={{
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                  backgroundColor: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--blue)' : '3px solid transparent',
                  textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: '1rem', opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
