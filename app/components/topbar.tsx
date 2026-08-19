'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/app/lib/auth-client'
import { NotificationBell } from '@/app/components/notification-bell'
import { NavSearch } from '@/app/components/nav-search'
import { Settings, User, ChevronDown, LogOut } from 'lucide-react'
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

export function Topbar({ role, name, email, nav }: TopbarProps) {
  const router = useRouter()

  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    function onDown(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [userMenuOpen])

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
