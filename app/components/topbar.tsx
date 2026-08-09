'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCompany } from '@/app/lib/company-context'
import { authClient } from '@/app/lib/auth-client'
import { NotificationBell } from '@/app/components/notification-bell'
import { Settings, User, ChevronDown, LogOut } from 'lucide-react'
import type { Company } from '@/app/lib/company-context'

const AVATAR_BG: Record<string, string> = {
  creator: '#E8820C',
  ceo:     '#0073BB',
  coo:     '#5A6A74',
  cto:     '#5A6A74',
}

interface TopbarProps {
  role: string
  companies: Company[]
  name: string
  email: string
}

interface Breadcrumb {
  label: string
  href: string
  isCurrent: boolean
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  if (pathname === '/dashboard') return []
  const segments = pathname.split('/').filter(Boolean).slice(0, 3)
  return segments.map((seg, i) => ({
    label: seg
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    href: '/' + segments.slice(0, i + 1).join('/'),
    isCurrent: i === segments.length - 1,
  }))
}

export function Topbar({ role, companies, name, email }: TopbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { activeCompany, setActiveCompany, companies: ctxCompanies } = useCompany()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [companySwitcherOpen, setCompanySwitcherOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const profileRef = useRef<HTMLDivElement>(null)
  const companySwitcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [userMenuOpen])

  // Close company switcher on outside click
  useEffect(() => {
    if (!companySwitcherOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (companySwitcherRef.current && !companySwitcherRef.current.contains(e.target as Node)) {
        setCompanySwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [companySwitcherOpen])

  const breadcrumbs = buildBreadcrumbs(pathname)

  async function handleLogout() {
    await authClient.signOut()
    router.push('/login')
  }

  return (
    <header
      style={{
        backgroundColor: '#232F3E',
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        zIndex: 50,
        gap: 12,
      }}
    >
      <style>{`
        .cbop-menu-item:hover { background-color: #F8F9FA !important; }
        .cbop-company-option:hover { background-color: #F5F7F9 !important; }
        .cbop-profile-btn:hover { background-color: rgba(255,255,255,0.08) !important; }
      `}</style>

      {/* LEFT: Breadcrumbs */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.href} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {i > 0 && (
              <span
                style={{
                  fontSize: 12,
                  color: '#8A9BA8',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                ›
              </span>
            )}
            {crumb.isCurrent ? (
              <span
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-inter), sans-serif',
                  color: '#ffffff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-inter), sans-serif',
                  color: '#8A9BA8',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </div>

      {/* CENTER: Company switcher (only after mount to avoid hydration mismatch) */}
      {mounted && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {ctxCompanies.length <= 1 ? (
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-inter), sans-serif',
                color: '#8A9BA8',
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                backgroundColor: 'rgba(138,155,168,0.12)',
                padding: '3px 10px',
                borderRadius: 20,
              }}
            >
              {activeCompany?.name ?? '—'}
            </span>
          ) : (
            <div ref={companySwitcherRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setCompanySwitcherOpen(!companySwitcherOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontFamily: 'var(--font-inter), sans-serif',
                  color: '#8A9BA8',
                  backgroundColor: 'rgba(138,155,168,0.12)',
                  border: 'none',
                  borderRadius: 20,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  maxWidth: 160,
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeCompany?.name ?? '—'}
                </span>
                <ChevronDown size={12} style={{ flexShrink: 0 }} />
              </button>

              {companySwitcherOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginTop: 4,
                    backgroundColor: '#fff',
                    border: '1px solid #D5DBDB',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 100,
                    minWidth: 168,
                    overflow: 'hidden',
                  }}
                >
                  {ctxCompanies.map((company) => (
                    <button
                      key={company.id}
                      className="cbop-company-option"
                      onClick={() => {
                        setActiveCompany(company)
                        setCompanySwitcherOpen(false)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 13,
                        fontFamily: 'var(--font-inter), sans-serif',
                        color: activeCompany?.id === company.id ? '#0073BB' : '#1A2332',
                        fontWeight: activeCompany?.id === company.id ? 500 : 400,
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                    >
                      {company.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* RIGHT: Notification bell + Profile dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <NotificationBell />

        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            className="cbop-profile-btn"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              transition: 'background-color 0.1s',
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: AVATAR_BG[role] ?? '#5A6A74',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: '#fff',
                fontFamily: 'var(--font-inter), sans-serif',
                letterSpacing: '0.03em',
                flexShrink: 0,
              }}
            >
              {getInitials(name)}
            </div>
            <span
              style={{
                fontSize: 13,
                color: '#ffffff',
                fontFamily: 'var(--font-inter), sans-serif',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
            <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }} />
          </button>

          {userMenuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                backgroundColor: '#fff',
                border: '1px solid #D5DBDB',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                zIndex: 100,
                minWidth: 192,
                overflow: 'hidden',
              }}
            >
              {/* Header: name, role badge, email — dark bg, no click */}
              <div style={{ padding: '12px 14px', backgroundColor: '#232F3E' }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#fff',
                    fontFamily: 'var(--font-inter), sans-serif',
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: AVATAR_BG[role] ?? '#8A9BA8',
                      fontFamily: 'var(--font-inter), sans-serif',
                    }}
                  >
                    {role.toUpperCase()}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#8A9BA8',
                    fontFamily: 'var(--font-inter), sans-serif',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {email}
                </div>
              </div>

              <div style={{ height: 1, backgroundColor: '#D5DBDB' }} />

              {/* Menu items */}
              <div style={{ padding: '4px 0' }}>
                <Link
                  href="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="cbop-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: '#1A2332',
                    textDecoration: 'none',
                    transition: 'background-color 0.08s',
                  }}
                >
                  <User size={14} style={{ color: '#5A6A74', flexShrink: 0 }} />
                  Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="cbop-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: '#1A2332',
                    textDecoration: 'none',
                    transition: 'background-color 0.08s',
                  }}
                >
                  <Settings size={14} style={{ color: '#5A6A74', flexShrink: 0 }} />
                  Settings
                </Link>
              </div>

              <div style={{ height: 1, backgroundColor: '#D5DBDB' }} />

              {/* Sign out */}
              <div style={{ padding: '4px 0' }}>
                <button
                  onClick={handleLogout}
                  className="cbop-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    width: '100%',
                    padding: '8px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: '#D13212',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.08s',
                  }}
                >
                  <LogOut size={14} style={{ color: '#D13212', flexShrink: 0 }} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
