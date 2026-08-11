'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, TrendingUp, Calculator, Landmark,
  Megaphone, Mail, UserCheck, Share2, Newspaper, BarChart2, Globe,
  Users, LayoutList, FileText, FileCode2, Scale,
  Settings, ShieldCheck, Terminal,
  ChevronDown, Circle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NavManifestGroup } from '@/api/lib/modules'

/**
 * The sidebar owns NO nav list and NO role list. Both come from the module
 * registry (api/lib/modules.ts) via GET /api/session, already filtered by the
 * caller's role and the active company's enabled modules. The only thing kept
 * here is the icon-name → component lookup, because React components cannot be
 * serialised through JSON.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  Calculator,
  Landmark,
  Megaphone,
  Mail,
  UserCheck,
  Share2,
  Newspaper,
  BarChart2,
  Globe,
  Users,
  LayoutList,
  FileText,
  FileCode2,
  Scale,
  Settings,
  ShieldCheck,
  Terminal,
}

export function Sidebar({ nav }: { nav: NavManifestGroup[] }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem('cbop_nav_groups')
      if (stored) setCollapsed(JSON.parse(stored))
    } catch {
      // ignore parse errors
    }
  }, [])

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem('cbop_nav_groups', JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  function isActive(href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <nav
      style={{
        width: 240,
        minWidth: 240,
        backgroundColor: 'var(--sidebar)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        borderRight: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <style>{`
        .cbop-sidebar-scroll::-webkit-scrollbar { width: 3px; }
        .cbop-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .cbop-sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 2px; }
        .cbop-nav-link:hover { background-color: rgba(255,255,255,0.05) !important; color: rgba(255,255,255,0.85) !important; }
        .cbop-group-btn:hover { background-color: rgba(255,255,255,0.04) !important; }
      `}</style>

      {/* Scrollable nav */}
      <div
        className="cbop-sidebar-scroll"
        style={{ flex: 1, overflowY: 'auto', paddingTop: 6, paddingBottom: 6 }}
      >
        {nav.map((group) => {
          const isGroupCollapsed = mounted ? !!collapsed[group.id] : false

          return (
            <div key={group.id} style={{ marginBottom: 2 }}>
              {/* Group header button */}
              <button
                className="cbop-group-btn"
                onClick={() => toggleGroup(group.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingLeft: 14,
                  paddingRight: 12,
                  paddingTop: 12,
                  paddingBottom: 4,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-inter), sans-serif',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#8A9BA8',
                  }}
                >
                  {group.label}
                </span>
                <ChevronDown
                  size={11}
                  style={{
                    color: '#8A9BA8',
                    opacity: 0.6,
                    transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.18s ease',
                    flexShrink: 0,
                  }}
                />
              </button>

              {/* Nav items */}
              {!isGroupCollapsed && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, paddingBottom: 2 }}>
                  {group.items.map((item) => {
                    const active = isActive(item.href)
                    const Icon = ICONS[item.icon] ?? Circle
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="cbop-nav-link"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 9,
                            paddingLeft: 12,
                            paddingRight: 14,
                            paddingTop: 7,
                            paddingBottom: 7,
                            textDecoration: 'none',
                            borderLeft: active
                              ? '2px solid var(--blue)'
                              : '2px solid transparent',
                            backgroundColor: active
                              ? 'rgba(0,115,187,0.11)'
                              : 'transparent',
                            color: active
                              ? '#ffffff'
                              : 'rgba(255,255,255,0.52)',
                            transition: 'background-color 0.1s, color 0.1s',
                            fontSize: 13,
                            fontFamily: 'var(--font-inter), sans-serif',
                            fontWeight: active ? 500 : 400,
                            lineHeight: 1.4,
                          }}
                        >
                          <Icon
                            size={15}
                            style={{
                              flexShrink: 0,
                              opacity: active ? 1 : 0.6,
                            }}
                          />
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

    </nav>
  )
}
