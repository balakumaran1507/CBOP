'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, Check, ChevronDown, Type } from 'lucide-react'
import { FONTS, CATEGORY_LABELS, fontStack, loadGoogleFonts, type FontCategory, type FontDef } from './fonts'

// Structural subset of editor.tsx's THEME.light/dark - passed straight through
// without needing a shared export (avoids a circular import with editor.tsx).
export interface PickerTheme {
  documentBg: string
  panelBorder: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  inputBg: string
  inputBorder: string
  inputColor: string
  btnActiveBg: string
  btnActiveColor: string
  imgBtnBg: string
}

const CATS: { key: 'all' | 'canva' | FontCategory; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'canva',       label: 'Canva Picks' },
  { key: 'system',      label: 'System' },
  { key: 'sans-serif',  label: 'Sans Serif' },
  { key: 'serif',       label: 'Serif' },
  { key: 'display',     label: 'Display' },
  { key: 'handwriting', label: 'Script' },
  { key: 'monospace',   label: 'Monospace' },
]

export interface FontPickerProps {
  /** Currently applied font family, or null/undefined for "Default". */
  value: string | null | undefined
  onChange: (family: string | null) => void
  t: PickerTheme
  /** Label shown on the closed toolbar button when no font is set. Defaults to "Default font". */
  placeholder?: string
  /** Show a "Default" row that resets to no explicit font (unsets the mark). Off for editors where every element always has a concrete font. */
  allowDefault?: boolean
  /** 'toolbar': compact borderless button (default, for a rich-text toolbar).
   *  'field': full-width bordered control matching a sidebar <select>, dropdown anchors to the right edge. */
  variant?: 'toolbar' | 'field'
}

export function FontPicker({ value, onChange, t, placeholder = 'Default font', allowDefault = true, variant = 'toolbar' }: FontPickerProps) {
  const isField = variant === 'field'
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [cat, setCat]       = useState<'all' | 'canva' | FontCategory>('all')
  const [menuPos, setMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const rootRef   = useRef<HTMLDivElement>(null)
  const btnRef    = useRef<HTMLButtonElement>(null)
  const menuRef   = useRef<HTMLDivElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rowRefs   = useRef(new Map<string, HTMLElement>())

  const currentFamily = value ?? null

  // The dropdown is portaled to <body> (position: fixed) so it can't be clipped
  // by a scrollable ancestor (e.g. the documents-editor sidebar's overflow:auto) -
  // compute its rect from the trigger button whenever it opens.
  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setMenuPos(isField
      ? { top: r.bottom + 4, right: window.innerWidth - r.right }
      : { top: r.bottom + 4, left: r.left })
  }, [open, isField])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
    else { setSearch(''); setCat('all') }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return FONTS.filter(f => {
      if (cat === 'canva' && !f.canva) return false
      if (cat !== 'all' && cat !== 'canva' && f.category !== cat) return false
      if (q && !f.family.toLowerCase().includes(q)) return false
      return true
    })
  }, [search, cat])

  // Lazy-load webfont CSS only for rows that actually scroll into view -
  // keeps the picker snappy even with ~190 fonts in the catalog.
  useEffect(() => {
    if (!open) return
    const root = listRef.current
    if (!root) return
    const seen = new Set<string>()
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const family = (entry.target as HTMLElement).dataset.family
        if (!family || seen.has(family)) continue
        seen.add(family)
        const def = FONTS.find(f => f.family === family)
        if (def) loadGoogleFonts([def])
        io.unobserve(entry.target)
      }
    }, { root, rootMargin: '250px 0px' })
    rowRefs.current.forEach(el => { if (root.contains(el)) io.observe(el) })
    return () => io.disconnect()
  }, [open, filtered])

  const apply = (def: FontDef | null) => {
    if (def) {
      loadGoogleFonts([def])
      onChange(def.family)
    } else {
      onChange(null)
    }
    setOpen(false)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', width: isField ? '100%' : undefined }}>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        title="Font"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          justifyContent: isField ? 'space-between' : 'flex-start',
          width: isField ? '100%' : undefined,
          height: isField ? 34 : 28,
          padding: isField ? '0 10px' : '0 8px',
          borderRadius: isField ? 6 : 4,
          border: isField ? `1px solid ${open ? t.btnActiveColor : t.inputBorder}` : 'none',
          background: isField ? t.inputBg : (open ? t.btnActiveBg : 'transparent'),
          color: isField ? t.inputColor : (open ? t.btnActiveColor : t.textSecondary),
          cursor: 'pointer', fontSize: isField ? 13 : 12,
          maxWidth: isField ? undefined : 150,
          flexShrink: 0, boxSizing: 'border-box',
        }}
      >
        <Type size={13} style={{ flexShrink: 0 }} />
        <span style={{
          flex: isField ? 1 : undefined,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: currentFamily ? fontStack(currentFamily) : 'inherit',
          textAlign: 'left',
        }}>
          {currentFamily ?? placeholder}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {open && menuPos && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: menuPos.top, left: menuPos.left, right: menuPos.right,
          zIndex: 1000,
          width: 300, maxHeight: 440, display: 'flex', flexDirection: 'column',
          background: t.documentBg, border: `1px solid ${t.panelBorder}`,
          borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.28)', overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 10px 8px', borderBottom: `1px solid ${t.panelBorder}`, flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: t.textMuted, pointerEvents: 'none' }} />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fonts…"
                style={{
                  width: '100%', height: 30, borderRadius: 5, border: `1px solid ${t.inputBorder}`,
                  background: t.inputBg, color: t.inputColor, fontSize: 12,
                  padding: '0 8px 0 26px', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto' }}>
              {CATS.map(c => (
                <button
                  key={c.key} type="button"
                  onMouseDown={e => { e.preventDefault(); setCat(c.key) }}
                  style={{
                    flexShrink: 0, fontSize: 11, padding: '4px 9px', borderRadius: 20,
                    border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: cat === c.key ? t.btnActiveBg : t.imgBtnBg,
                    color: cat === c.key ? t.btnActiveColor : t.textSecondary,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div ref={listRef} style={{ overflowY: 'auto', padding: 6 }}>
            {allowDefault && (
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); apply(null) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5,
                  border: 'none', cursor: 'pointer', fontSize: 13, marginBottom: 2,
                  background: !currentFamily ? t.btnActiveBg : 'transparent',
                  color: !currentFamily ? t.btnActiveColor : t.textPrimary,
                }}
              >
                Default
                {!currentFamily && <Check size={13} />}
              </button>
            )}

            {filtered.length === 0 && (
              <div style={{ padding: '24px 10px', textAlign: 'center', fontSize: 12, color: t.textMuted }}>
                No fonts match &ldquo;{search}&rdquo;
              </div>
            )}

            {filtered.map(f => {
              const active = currentFamily === f.family
              return (
                <button
                  key={f.family} type="button"
                  ref={el => { if (el) rowRefs.current.set(f.family, el) }}
                  data-family={f.family}
                  onMouseDown={e => { e.preventDefault(); apply(f) }}
                  title={CATEGORY_LABELS[f.category]}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 5,
                    border: 'none', cursor: 'pointer',
                    background: active ? t.btnActiveBg : 'transparent',
                    color: active ? t.btnActiveColor : t.textPrimary,
                  }}
                >
                  <span style={{
                    fontFamily: fontStack(f.family), fontSize: 15,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {f.family}
                  </span>
                  {active
                    ? <Check size={13} style={{ flexShrink: 0, marginLeft: 8 }} />
                    : f.canva
                      ? <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 9, fontWeight: 700, color: t.textMuted, letterSpacing: '0.04em' }}>CANVA</span>
                      : null
                  }
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
