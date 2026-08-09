'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Page {
  label: string
  href: string
  group: string
  roles: string[]
}

const ALL_PAGES: Page[] = [
  { label: 'Dashboard',    href: '/dashboard',    group: 'Revenue',   roles: [] },
  { label: 'Sales',        href: '/sales',         group: 'Revenue',   roles: [] },
  { label: 'Accounting',   href: '/accounting',    group: 'Revenue',   roles: ['creator', 'ceo'] },
  { label: 'Tax',          href: '/tax',            group: 'Revenue',   roles: ['creator', 'ceo'] },
  { label: 'Campaigns',    href: '/campaigns',     group: 'Growth',    roles: [] },
  { label: 'Email Studio', href: '/email-studio',  group: 'Growth',    roles: [] },
  { label: 'Subscribers',  href: '/subscribers',   group: 'Growth',    roles: [] },
  { label: 'Social',       href: '/social',        group: 'Growth',    roles: ['creator', 'ceo'] },
  { label: 'Blog',         href: '/blog',           group: 'Growth',    roles: ['creator', 'ceo'] },
  { label: 'SEO',          href: '/seo',            group: 'Growth',    roles: ['creator', 'ceo'] },
  { label: 'Website',      href: '/website',       group: 'Growth',    roles: ['creator', 'ceo'] },
  { label: 'Hiring',       href: '/hiring',        group: 'People',    roles: [] },
  { label: 'Employees',    href: '/people',         group: 'People',    roles: [] },
  { label: 'Work',         href: '/work',           group: 'People',    roles: [] },
  { label: 'Documents',    href: '/documents',     group: 'Knowledge', roles: [] },
  { label: 'Templates',    href: '/templates',     group: 'Knowledge', roles: [] },
  { label: 'Legal',        href: '/legal',          group: 'Knowledge', roles: ['creator', 'ceo'] },
  { label: 'Settings',     href: '/settings',      group: 'System',    roles: [] },
  { label: 'Audit',        href: '/audit',          group: 'System',    roles: ['creator', 'ceo'] },
  { label: 'Command',      href: '/command',       group: 'System',    roles: ['creator', 'ceo'] },
  { label: 'Profile',      href: '/profile',       group: 'Account',   roles: [] },
]

const GROUP_STYLES: Record<string, { bg: string; color: string }> = {
  Revenue:   { bg: '#E8F4F8', color: '#0073BB' },
  Growth:    { bg: '#F0FBF0', color: '#1D8102' },
  People:    { bg: '#FFF8F0', color: '#E8820C' },
  Knowledge: { bg: '#F8F0FF', color: '#7B5EA7' },
  System:    { bg: '#F5F5F5', color: '#5A6A74' },
  Account:   { bg: '#F0F0F0', color: '#1A2332' },
}

const RECENT_KEY = 'cbop_palette_recent'
const MAX_RECENT = 5

function getStoredRecent(): Page[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as Page[]) : []
  } catch {
    return []
  }
}

function addToStoredRecent(page: Page): void {
  try {
    const prev = getStoredRecent().filter((p) => p.href !== page.href)
    localStorage.setItem(RECENT_KEY, JSON.stringify([page, ...prev].slice(0, MAX_RECENT)))
  } catch {
    // ignore
  }
}

function isPageVisible(page: Page, role: string): boolean {
  if (page.roles.length === 0) return true
  if (role === 'creator') return true
  return page.roles.includes(role)
}

export function CommandPalette({ role }: { role: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recent, setRecent] = useState<Page[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const visiblePages = ALL_PAGES.filter((p) => isPageVisible(p, role))
  const visibleRecent = recent.filter((p) => isPageVisible(p, role))

  const filteredPages = query
    ? visiblePages.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))
    : []

  // Combined list for keyboard nav — depends on query state
  const allItems: Page[] = query
    ? filteredPages
    : [
        ...visibleRecent,
        ...visiblePages.filter((p) => !visibleRecent.some((r) => r.href === p.href)),
      ]

  function openPalette() {
    setRecent(getStoredRecent())
    setQuery('')
    setSelectedIndex(0)
    setOpen(true)
  }

  function closePalette() {
    setOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }

  const navigate = useCallback((page: Page) => {
    addToStoredRecent(page)
    router.push(page.href)
    closePalette()
  // closePalette uses only setState calls — stable reference is fine here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) { closePalette() } else { openPalette() }
      }
      if (e.key === 'Escape' && open) { closePalette() }
    }
    document.addEventListener('keydown', handleGlobalKey)
    return () => document.removeEventListener('keydown', handleGlobalKey)
  }, [open])

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(t)
    }
  }, [open])

  // Arrow key + Enter navigation
  useEffect(() => {
    if (!open) return
    function handleNavKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = allItems[selectedIndex]
        if (item) navigate(item)
      }
    }
    document.addEventListener('keydown', handleNavKey)
    return () => document.removeEventListener('keydown', handleNavKey)
  }, [open, allItems, selectedIndex, navigate])

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0) }, [query])

  if (!open) return null

  function ResultItem({ page, index }: { page: Page; index: number }) {
    const gs = GROUP_STYLES[page.group] ?? { bg: '#F5F5F5', color: '#5A6A74' }
    const isSelected = index === selectedIndex
    return (
      <li>
        <button
          onClick={() => navigate(page)}
          onMouseEnter={() => setSelectedIndex(index)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            backgroundColor: isSelected ? '#F8F9FA' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background-color 0.08s',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-inter), sans-serif',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 4,
              backgroundColor: gs.bg,
              color: gs.color,
              flexShrink: 0,
              lineHeight: 1.6,
            }}
          >
            {page.group}
          </span>
          <span
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-inter), sans-serif',
              color: '#1A2332',
              flex: 1,
            }}
          >
            {page.label}
          </span>
          <span
            style={{
              fontSize: 14,
              color: '#8A9BA8',
              opacity: isSelected ? 1 : 0,
              transition: 'opacity 0.08s',
            }}
          >
            →
          </span>
        </button>
      </li>
    )
  }

  const nonRecentPages = visiblePages.filter((p) => !visibleRecent.some((r) => r.href === p.href))

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) closePalette() }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 120,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        style={{
          maxWidth: 512,
          width: '100%',
          backgroundColor: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div style={{ padding: '0 16px' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, actions…"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              fontFamily: 'var(--font-inter), sans-serif',
              color: '#1A2332',
              padding: '14px 0',
              backgroundColor: 'transparent',
            }}
          />
        </div>
        <div style={{ height: 1, backgroundColor: '#F0F0F0' }} />

        {/* Results */}
        <div style={{ overflowY: 'auto', maxHeight: 320 }}>
          {query ? (
            // Filtered results
            filteredPages.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
                {filteredPages.map((page, i) => (
                  <ResultItem key={page.href} page={page} index={i} />
                ))}
              </ul>
            ) : (
              <div
                style={{
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontFamily: 'var(--font-inter), sans-serif',
                  color: '#8A9BA8',
                }}
              >
                No pages match &ldquo;{query}&rdquo;
              </div>
            )
          ) : (
            // Empty query: recent + all pages
            <>
              {visibleRecent.length > 0 && (
                <>
                  <div
                    style={{
                      padding: '8px 12px 4px',
                      fontSize: 10,
                      fontFamily: 'var(--font-inter), sans-serif',
                      fontWeight: 600,
                      color: '#8A9BA8',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recent
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 4px' }}>
                    {visibleRecent.map((page, i) => (
                      <ResultItem key={page.href} page={page} index={i} />
                    ))}
                  </ul>
                  <div style={{ height: 1, backgroundColor: '#F0F0F0', margin: '0 12px' }} />
                </>
              )}
              {nonRecentPages.length > 0 && (
                <>
                  <div
                    style={{
                      padding: '8px 12px 4px',
                      fontSize: 10,
                      fontFamily: 'var(--font-inter), sans-serif',
                      fontWeight: 600,
                      color: '#8A9BA8',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    All Pages
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 4px' }}>
                    {nonRecentPages.map((page, i) => (
                      <ResultItem key={page.href} page={page} index={visibleRecent.length + i} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div style={{ height: 1, backgroundColor: '#F0F0F0' }} />
        <div
          style={{
            padding: '7px 16px',
            textAlign: 'center',
            fontSize: 11,
            fontFamily: 'var(--font-inter), sans-serif',
            color: '#8A9BA8',
            backgroundColor: '#FAFAFA',
            letterSpacing: '0.02em',
          }}
        >
          ↑↓ navigate&nbsp;&nbsp;&nbsp;↵ open&nbsp;&nbsp;&nbsp;esc close
        </div>
      </div>
    </div>
  )
}
