'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/app/lib/company-context'
import { authClient } from '@/app/lib/auth-client'
import { NotificationBell } from '@/app/components/notification-bell'
import { NavSearch } from '@/app/components/nav-search'
import { Settings, User, ChevronDown, LogOut, Building2 } from 'lucide-react'
import type { Company } from '@/app/lib/company-context'
import type { NavManifestGroup } from '@/api/lib/modules'

const AVATAR_BG: Record<string, string> = {
  creator: '#E8820C',
  ceo:     '#0073BB',
  coo:     '#1D8102',
  cto:     '#7B61FF',
}

const ROLE_LABEL: Record<string, string> = {
  creator: 'Creator',
  ceo:     'CEO',
  coo:     'COO',
  cto:     'CTO',
}

interface TopbarProps {
  role: string
  companies: Company[]
  name: string
  email: string
  nav: NavManifestGroup[]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

export function Topbar({ role, companies, name, email, nav }: TopbarProps) {
  const router = useRouter()
  const { activeCompany, setActiveCompany, companies: ctxCompanies } = useCompany()

  const [userMenuOpen,       setUserMenuOpen]       = useState(false)
  const [companySwitcherOpen, setCompanySwitcherOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const profileRef         = useRef<HTMLDivElement>(null)
  const companySwitcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!userMenuOpen) return
    function onDown(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [userMenuOpen])

  useEffect(() => {
    if (!companySwitcherOpen) return
    function onDown(e: MouseEvent) {
      if (companySwitcherRef.current && !companySwitcherRef.current.contains(e.target as Node)) setCompanySwitcherOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [companySwitcherOpen])

  async function handleLogout() {
    await authClient.signOut()
    router.push('/login')
  }

  return (
    <header
      style={{
        backgroundColor: '#1A2332',
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        zIndex: 50,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <style>{`
        .cbop-nav-hover:hover { background-color: rgba(255,255,255,0.07) !important; }
        .cbop-menu-item:hover { background-color: #F5F7FA !important; }
        .cbop-company-opt:hover { background-color: #F0F4F8 !important; }
        .cbop-company-opt-active { background-color: #EBF4FB !important; }
        .cbop-signout:hover { background-color: #FEF2F0 !important; }
      `}</style>

      {/* ── BRAND (matches sidebar width exactly) ── */}
      <div
        style={{
          width: 240,
          minWidth: 240,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-syne)',
            fontSize: 15,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '0.08em',
          }}
        >
          CBOP
        </span>
      </div>

      {/* ── SEARCH ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          minWidth: 0,
        }}
      >
        <NavSearch nav={nav} />
      </div>

      {/* ── RIGHT SECTION ── */}
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, gap: 4, flexShrink: 0 }}>

        {/* Company switcher */}
        {mounted && (
          <div ref={companySwitcherRef} style={{ position: 'relative', marginRight: 4 }}>
            {ctxCompanies.length <= 1 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontFamily: 'var(--font-inter), sans-serif',
                  color: 'rgba(255,255,255,0.55)',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  padding: '4px 10px',
                }}
              >
                <Building2 size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
                <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeCompany?.name ?? '—'}
                </span>
              </div>
            ) : (
              <>
                <button
                  className="cbop-nav-hover"
                  onClick={() => setCompanySwitcherOpen(!companySwitcherOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: 'rgba(255,255,255,0.75)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 6,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    transition: 'background-color 0.1s',
                  }}
                >
                  <Building2 size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeCompany?.name ?? '—'}
                  </span>
                  <ChevronDown
                    size={11}
                    style={{
                      flexShrink: 0,
                      opacity: 0.5,
                      transform: companySwitcherOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s',
                    }}
                  />
                </button>

                {companySwitcherOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      backgroundColor: '#ffffff',
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
                      zIndex: 100,
                      minWidth: 200,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 12px 6px',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: '#94A3B8',
                        fontFamily: 'var(--font-inter), sans-serif',
                      }}
                    >
                      Switch company
                    </div>
                    {ctxCompanies.map((company) => {
                      const isSelected = activeCompany?.id === company.id
                      return (
                        <button
                          key={company.id}
                          className={`cbop-company-opt${isSelected ? ' cbop-company-opt-active' : ''}`}
                          onClick={() => { setActiveCompany(company); setCompanySwitcherOpen(false) }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            fontSize: 13,
                            fontFamily: 'var(--font-inter), sans-serif',
                            color: isSelected ? '#0073BB' : '#1E293B',
                            fontWeight: isSelected ? 600 : 400,
                            backgroundColor: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          {isSelected && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#0073BB', flexShrink: 0 }} />
                          )}
                          {!isSelected && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#CBD5E1', flexShrink: 0 }} />
                          )}
                          {company.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Notification bell */}
        <NotificationBell />

        {/* Profile dropdown */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            className="cbop-nav-hover"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'transparent',
              border: '1px solid transparent',
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
                boxShadow: '0 0 0 2px rgba(255,255,255,0.12)',
              }}
            >
              {getInitials(name)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 12,
                  color: '#ffffff',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontWeight: 500,
                  maxWidth: 100,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
              >
                {name.split(' ')[0]}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: AVATAR_BG[role] ?? 'rgba(255,255,255,0.45)',
                  fontFamily: 'var(--font-inter), sans-serif',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  lineHeight: 1.2,
                }}
              >
                {ROLE_LABEL[role] ?? role}
              </span>
            </div>
            <ChevronDown
              size={12}
              style={{
                color: 'rgba(255,255,255,0.35)',
                flexShrink: 0,
                transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
              }}
            />
          </button>

          {userMenuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 6px)',
                backgroundColor: '#ffffff',
                border: '1px solid #E2E8F0',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                zIndex: 100,
                minWidth: 208,
                overflow: 'hidden',
              }}
            >
              {/* Profile header */}
              <div
                style={{
                  padding: '14px 16px 12px',
                  background: 'linear-gradient(135deg, #1A2332 0%, #232F3E 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    backgroundColor: AVATAR_BG[role] ?? '#5A6A74',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#fff',
                    fontFamily: 'var(--font-inter), sans-serif',
                    flexShrink: 0,
                    boxShadow: '0 0 0 2px rgba(255,255,255,0.15)',
                  }}
                >
                  {getInitials(name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#fff',
                      fontFamily: 'var(--font-inter), sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 2,
                    }}
                  >
                    {name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#fff',
                        fontFamily: 'var(--font-inter), sans-serif',
                        backgroundColor: AVATAR_BG[role] ?? '#5A6A74',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {ROLE_LABEL[role] ?? role}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.45)',
                      fontFamily: 'var(--font-inter), sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 3,
                    }}
                  >
                    {email}
                  </div>
                </div>
              </div>

              <div style={{ height: 1, backgroundColor: '#F1F5F9' }} />

              {/* Menu items */}
              <div style={{ padding: '4px 0' }}>
                <Link
                  href="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="cbop-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: '#334155',
                    textDecoration: 'none',
                    transition: 'background-color 0.08s',
                  }}
                >
                  <User size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                  My Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="cbop-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-inter), sans-serif',
                    color: '#334155',
                    textDecoration: 'none',
                    transition: 'background-color 0.08s',
                  }}
                >
                  <Settings size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                  Settings
                </Link>
              </div>

              <div style={{ height: 1, backgroundColor: '#F1F5F9' }} />

              <div style={{ padding: '4px 0' }}>
                <button
                  onClick={handleLogout}
                  className="cbop-signout"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '9px 14px',
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
