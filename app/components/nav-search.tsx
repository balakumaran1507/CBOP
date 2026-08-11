'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Clock, ArrowRight,
  LayoutDashboard, TrendingUp, Calculator, Landmark,
  Megaphone, Mail, UserCheck, Share2, Newspaper, BarChart2, Globe,
  Users, LayoutList, FileText, FileCode2, Scale,
  Settings, ShieldCheck, Terminal, Circle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NavManifestGroup } from '@/api/lib/modules'

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, TrendingUp, Calculator, Landmark,
  Megaphone, Mail, UserCheck, Share2, Newspaper, BarChart2, Globe,
  Users, LayoutList, FileText, FileCode2, Scale,
  Settings, ShieldCheck, Terminal,
}

const GROUP_COLOR: Record<string, string> = {
  Revenue:   '#0073BB',
  Growth:    '#1D8102',
  People:    '#7B61FF',
  Knowledge: '#E8820C',
  System:    '#5A6A74',
}

interface SearchItem {
  key: string
  label: string
  href: string
  icon: string
  group: string
}

interface RecentItem {
  href: string
  label: string
  icon: string
  group: string
}

const STORAGE_KEY = 'cbop_recent_nav'
const MAX_RECENT  = 5

function getRecent(): RecentItem[] {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? (JSON.parse(s) as RecentItem[]) : []
  } catch { return [] }
}

function pushRecent(item: RecentItem) {
  try {
    const next = [item, ...getRecent().filter(r => r.href !== item.href)].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

export function NavSearch({ nav }: { nav: NavManifestGroup[] }) {
  const router = useRouter()

  const inputRef   = useRef<HTMLInputElement>(null)
  const dropRef    = useRef<HTMLDivElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)

  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [activeIdx,   setActiveIdx]   = useState(-1)
  const [recent,      setRecent]      = useState<RecentItem[]>([])

  // Flatten nav → searchable items
  const allItems: SearchItem[] = nav.flatMap(group =>
    group.items.map(item => ({
      key:   item.key,
      label: item.label,
      href:  item.href,
      icon:  item.icon,
      group: group.label,
    }))
  )

  // Filter results
  const q = query.trim().toLowerCase()
  const results: SearchItem[] = q
    ? allItems.filter(i =>
        i.label.toLowerCase().includes(q) ||
        i.group.toLowerCase().includes(q)
      )
    : allItems

  // "/" shortcut: focus the input from anywhere outside an input/textarea
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase()
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onGlobalKey)
    return () => document.removeEventListener('keydown', onGlobalKey)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (!inputRef.current?.contains(t) && !dropRef.current?.contains(t)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return
    const el = listRef.current.querySelectorAll<HTMLElement>('[data-row]')[activeIdx]
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  function openSearch() {
    setRecent(getRecent())
    setOpen(true)
    setActiveIdx(-1)
  }

  function close() {
    setOpen(false)
    setQuery('')
    setActiveIdx(-1)
  }

  function navigate(item: SearchItem | RecentItem) {
    pushRecent({ href: item.href, label: item.label, icon: item.icon, group: item.group })
    close()
    router.push(item.href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const list: (SearchItem | RecentItem)[] = q ? results : (recent.length ? recent : allItems)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => (i + 1) % list.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => (i <= 0 ? list.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0 && list[activeIdx]) navigate(list[activeIdx])
    } else if (e.key === 'Escape') {
      close()
      inputRef.current?.blur()
    }
  }

  // ─── render ───────────────────────────────────────────────────────────────
  // Figure out which list we render and how many items from "recent" section
  const showRecent  = open && !q && recent.length > 0
  const showAll     = open && !q
  const showResults = open && !!q

  // Flat index offset so ArrowDown works across sections
  let rowIndex = 0

  function Row({ item, thisIdx }: { item: SearchItem | RecentItem; thisIdx: number }) {
    const Icon   = ICONS[item.icon] ?? Circle
    const isActive = thisIdx === activeIdx
    const color    = GROUP_COLOR[item.group] ?? '#5A6A74'
    return (
      <div
        data-row
        onMouseEnter={() => setActiveIdx(thisIdx)}
        onMouseDown={(e) => { e.preventDefault(); navigate(item) }}
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          padding:        '8px 14px',
          cursor:         'pointer',
          backgroundColor: isActive ? '#F0F6FF' : 'transparent',
          borderLeft:     isActive ? '2px solid #0073BB' : '2px solid transparent',
          transition:     'background-color 0.05s',
        }}
      >
        {/* Icon chip */}
        <div
          style={{
            width:           30,
            height:          30,
            borderRadius:    6,
            backgroundColor: isActive ? `${color}18` : '#F1F5F9',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            flexShrink:      0,
            transition:      'background-color 0.05s',
          }}
        >
          <Icon size={14} style={{ color: isActive ? color : '#64748B' }} />
        </div>

        {/* Label + group */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize:     13,
              fontWeight:   isActive ? 600 : 400,
              color:        isActive ? '#0F172A' : '#1E293B',
              fontFamily:   'var(--font-inter), sans-serif',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              lineHeight:   1.3,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize:   11,
              color:      '#94A3B8',
              fontFamily: 'var(--font-inter), sans-serif',
              marginTop:  1,
              lineHeight: 1.2,
            }}
          >
            {item.group}
          </div>
        </div>

        {/* Arrow on hover */}
        {isActive && (
          <ArrowRight size={13} style={{ color: '#0073BB', flexShrink: 0 }} />
        )}
      </div>
    )
  }

  return (
    <>
      <style>{`
        .cbop-search-input::placeholder { color: rgba(255,255,255,0.32); }
        .cbop-search-input:focus { outline: none; }
        .cbop-drop-scroll::-webkit-scrollbar { width: 4px; }
        .cbop-drop-scroll::-webkit-scrollbar-track { background: transparent; }
        .cbop-drop-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }
      `}</style>

      <div
        style={{
          position:  'relative',
          flex:      1,
          maxWidth:  520,
          minWidth:  0,
        }}
      >
        {/* ── Input ── */}
        <div
          style={{
            position:        'relative',
            display:         'flex',
            alignItems:      'center',
            backgroundColor: open ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.07)',
            border:          open ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.10)',
            borderRadius:    open ? '6px 6px 0 0' : 6,
            transition:      'background-color 0.15s, border-color 0.15s',
          }}
        >
          <Search
            size={14}
            style={{
              position:    'absolute',
              left:        11,
              color:       open ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
              pointerEvents: 'none',
              transition:  'color 0.15s',
              flexShrink:  0,
            }}
          />
          <input
            ref={inputRef}
            className="cbop-search-input"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(-1) }}
            onFocus={openSearch}
            onKeyDown={onKeyDown}
            placeholder="Search features…"
            autoComplete="off"
            spellCheck={false}
            style={{
              width:       '100%',
              height:      34,
              paddingLeft: 34,
              paddingRight: open ? 12 : 36,
              fontSize:    13,
              fontFamily:  'var(--font-inter), sans-serif',
              color:       '#ffffff',
              background:  'transparent',
              border:      'none',
            }}
          />
          {/* "/" hint when closed */}
          {!open && (
            <kbd
              style={{
                position:        'absolute',
                right:           9,
                fontSize:        11,
                color:           'rgba(255,255,255,0.28)',
                fontFamily:      'var(--font-inter), sans-serif',
                backgroundColor: 'rgba(255,255,255,0.07)',
                border:          '1px solid rgba(255,255,255,0.12)',
                borderRadius:    4,
                padding:         '1px 5px',
                pointerEvents:   'none',
                lineHeight:      1.6,
              }}
            >
              /
            </kbd>
          )}
        </div>

        {/* ── Dropdown ── */}
        {open && (
          <div
            ref={dropRef}
            style={{
              position:        'absolute',
              top:             '100%',
              left:            0,
              right:           0,
              backgroundColor: '#ffffff',
              border:          '1px solid rgba(255,255,255,0.22)',
              borderTop:       'none',
              borderRadius:    '0 0 8px 8px',
              boxShadow:       '0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
              zIndex:          200,
              overflow:        'hidden',
            }}
          >
            <div
              ref={listRef}
              className="cbop-drop-scroll"
              style={{ maxHeight: 400, overflowY: 'auto' }}
            >
              {/* No results */}
              {showResults && results.length === 0 && (
                <div
                  style={{
                    padding:    '20px 14px',
                    textAlign:  'center',
                    fontSize:   13,
                    color:      '#94A3B8',
                    fontFamily: 'var(--font-inter), sans-serif',
                  }}
                >
                  No features match &ldquo;{query}&rdquo;
                </div>
              )}

              {/* Search results */}
              {showResults && results.map(item => {
                const idx = rowIndex++
                return <Row key={item.href} item={item} thisIdx={idx} />
              })}

              {/* Recently visited */}
              {showRecent && (
                <>
                  <SectionLabel icon={<Clock size={11} />} label="Recently visited" />
                  {recent.map(item => {
                    const idx = rowIndex++
                    return <Row key={item.href + '-recent'} item={item} thisIdx={idx} />
                  })}
                  <div style={{ height: 1, backgroundColor: '#F1F5F9', margin: '4px 0' }} />
                </>
              )}

              {/* All features */}
              {showAll && (
                <>
                  <SectionLabel label="All features" />
                  {allItems.map(item => {
                    const idx = rowIndex++
                    return <Row key={item.href} item={item} thisIdx={idx} />
                  })}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div
              style={{
                display:         'flex',
                alignItems:      'center',
                gap:             12,
                padding:         '6px 14px',
                borderTop:       '1px solid #F1F5F9',
                backgroundColor: '#FAFBFC',
              }}
            >
              {[
                { keys: ['↑', '↓'], label: 'navigate' },
                { keys: ['↵'],      label: 'select' },
                { keys: ['Esc'],    label: 'close' },
              ].map(({ keys, label }) => (
                <span
                  key={label}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {keys.map(k => (
                    <kbd
                      key={k}
                      style={{
                        fontSize:        10,
                        color:           '#64748B',
                        fontFamily:      'var(--font-inter), sans-serif',
                        backgroundColor: '#F1F5F9',
                        border:          '1px solid #E2E8F0',
                        borderRadius:    3,
                        padding:         '1px 4px',
                        lineHeight:      1.6,
                      }}
                    >
                      {k}
                    </kbd>
                  ))}
                  <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-inter), sans-serif' }}>
                    {label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function SectionLabel({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:         5,
        padding:     '10px 14px 5px',
        fontSize:    10,
        fontWeight:  600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color:       '#94A3B8',
        fontFamily:  'var(--font-inter), sans-serif',
      }}
    >
      {icon}
      {label}
    </div>
  )
}
