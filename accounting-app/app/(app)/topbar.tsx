'use client'

import { useState, useRef, useEffect } from 'react'
import { useCbopSession } from '../lib/session-context'
import { Building2, ChevronDown, ArrowLeft } from 'lucide-react'

export function Topbar() {
  const { name, role, companies, activeCompany, setActiveCompanyId } = useCbopSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const ROLE_COLOR: Record<string, string> = {
    creator: '#E8820C',
    ceo:     '#0073BB',
    coo:     '#1D8102',
    cto:     '#7B61FF',
  }
  const roleColor = ROLE_COLOR[role] ?? '#5A6A74'

  return (
    <header
      style={{
        height: 48,
        backgroundColor: '#1A2332',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        gap: 12,
        flexShrink: 0,
      }}
    >
      <style>{`
        .acct-co-opt:hover { background-color: #F0F6FF !important; }
        .acct-topbar-btn:hover { background-color: rgba(255,255,255,0.07) !important; }
      `}</style>

      {/* Brand */}
      <span style={{ fontFamily: 'var(--font-display, sans-serif)', fontWeight: 700, fontSize: 14, color: '#ffffff', letterSpacing: '0.05em', flexShrink: 0 }}>
        CBOP <span style={{ color: 'rgba(255,255,255,0.45)' }}>/ Accounting</span>
      </span>

      <div style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

      {/* Company selector */}
      {companies.length > 0 && (
        <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            className="acct-topbar-btn"
            onClick={() => setOpen(o => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.10)',
              backgroundColor: 'rgba(255,255,255,0.06)',
              cursor: companies.length > 1 ? 'pointer' : 'default',
              color: 'rgba(255,255,255,0.80)',
              transition: 'background-color 0.1s',
            }}
          >
            <Building2 size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: 'var(--font-inter, sans-serif)', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeCompany?.name ?? '—'}
            </span>
            {companies.length > 1 && (
              <ChevronDown size={11} style={{ opacity: 0.5, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            )}
          </button>

          {open && companies.length > 1 && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              backgroundColor: '#ffffff',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              zIndex: 100,
              minWidth: 200,
              overflow: 'hidden',
            }}>
              <div style={{ padding: '8px 12px 5px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', fontFamily: 'var(--font-inter, sans-serif)' }}>
                Switch company
              </div>
              {companies.map(co => {
                const isActive = co.id === activeCompany?.id
                return (
                  <button
                    key={co.id}
                    className="acct-co-opt"
                    onClick={() => { setActiveCompanyId(co.id); setOpen(false) }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      fontFamily: 'var(--font-inter, sans-serif)',
                      color: isActive ? '#0073BB' : '#1E293B',
                      fontWeight: isActive ? 600 : 400,
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: isActive ? '#0073BB' : '#CBD5E1', flexShrink: 0 }} />
                    {co.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User + back link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: roleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: 'sans-serif', flexShrink: 0 }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.70)', fontFamily: 'var(--font-inter, sans-serif)' }}>
            {name.split(' ')[0]}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: roleColor, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-inter, sans-serif)' }}>
            {role}
          </span>
        </div>

        <a
          href="https://cbop.etherence.com/dashboard"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.40)', fontFamily: 'var(--font-inter, sans-serif)', textDecoration: 'none', transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.75)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.40)')}
        >
          <ArrowLeft size={12} />
          Back to CBOP
        </a>
      </div>
    </header>
  )
}
