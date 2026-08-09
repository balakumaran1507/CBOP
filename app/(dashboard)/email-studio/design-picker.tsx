'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { Mail, ChevronDown, Search, Plus, Pencil, Check } from 'lucide-react'
import type { EmailDesign } from './page'
import type { EmailStudioEditorProps } from './editor'

const EmailStudioEditorDynamic = dynamic<EmailStudioEditorProps>(
  () => import('./editor'),
  { ssr: false, loading: () => null }
)

interface Company { id: string; name: string }

// Reusable "pick or author an Email Studio design" control - embedded wherever
// CBOP sends email (Documents generate flow, Campaigns composer, ...) instead
// of each module rolling its own subject/body fields.
export function EmailDesignPicker({
  value, onChange, companies, placeholder = 'No email design selected',
}: {
  value: string | null
  onChange: (designId: string | null) => void
  companies: Company[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  const [editTarget, setEditTarget] = useState<EmailDesign | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data, refetch } = useQuery({
    queryKey: ['email-designs-picker'],
    queryFn: async () => {
      const res = await fetch('/api/email-designs', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      return res.json() as Promise<{ designs: EmailDesign[] }>
    },
  })
  const designs = data?.designs ?? []
  const selected = designs.find(d => d.id === value) ?? null
  const filtered = designs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, left: r.left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (editing) {
    return (
      <EmailStudioEditorDynamic
        design={editTarget}
        companies={companies}
        onClose={() => setEditing(false)}
        onSaved={(id) => {
          setEditing(false)
          refetch().then(() => { if (id) onChange(id) })
        }}
      />
    )
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px',
          background: '#fff', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
        }}
      >
        <Mail size={14} color="var(--text3)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {selected ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.subject}</div>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>{placeholder}</span>
          )}
        </span>
        {selected && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); setEditTarget(selected); setEditing(true) }}
            style={{ display: 'flex', color: 'var(--text3)', padding: 4 }}
            title="Edit this design"
          >
            <Pencil size={13} />
          </span>
        )}
        <ChevronDown size={14} color="var(--text3)" style={{ flexShrink: 0 }} />
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 1000,
            width: 320, maxHeight: 420, display: 'flex', flexDirection: 'column',
            background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
              <input
                autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search designs…"
                style={{ width: '100%', height: 30, borderRadius: 5, border: '1px solid var(--border)', padding: '0 8px 0 26px', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setEditTarget(null); setEditing(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: '#F8FAFB', cursor: 'pointer', color: 'var(--blue)', fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={14} /> Create new design
          </button>

          <div style={{ overflowY: 'auto', padding: 6 }}>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', background: 'transparent' }}
              >
                Clear selection
              </button>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
                {designs.length === 0 ? 'No designs yet - create one above.' : 'No designs match your search.'}
              </div>
            )}
            {filtered.map(d => {
              const active = d.id === value
              return (
                <button
                  key={d.id} type="button"
                  onClick={() => { onChange(d.id); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 5,
                    border: 'none', cursor: 'pointer',
                    background: active ? '#E8F4FB' : 'transparent',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: active ? 'var(--blue)' : 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.category} · {d.content_mode === 'html' ? 'HTML' : 'Rich Text'}</div>
                  </span>
                  {active && <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} />}
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
