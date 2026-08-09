'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, FileText, Mail } from 'lucide-react'
import dynamic from 'next/dynamic'

import type { TemplateEditorProps } from './editor'

const TemplateEditorDynamic = dynamic<TemplateEditorProps>(
  () => import('./editor'),
  { ssr: false, loading: () => null }
)

// ── Types ─────────────────────────────────────────────────────────────────────

type TemplateType = 'invoice' | 'proposal' | 'contract' | 'nda' | 'mou' | 'email' | 'onboarding'
type OutputType   = 'pdf' | 'email' | 'both'

interface Template {
  id: string
  name: string
  type: TemplateType
  output_type: OutputType
  version: number
  slug?: string
  company_id: string
  company_name: string
  updated_at: string
}

interface Company { id: string; name: string; logo_url?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<TemplateType, string> = {
  invoice: 'Invoice', proposal: 'Proposal', contract: 'Contract',
  nda: 'NDA', mou: 'MOU', email: 'Email', onboarding: 'Onboarding',
}

const TYPE_STYLE: Record<TemplateType, React.CSSProperties> = {
  invoice:    { background: '#E8F4FB', color: '#0073BB' },
  proposal:   { background: '#EBF5E8', color: '#1D8102' },
  contract:   { background: '#EDE9FE', color: '#5B21B6' },
  nda:        { background: '#FEF3C7', color: '#92400E' },
  mou:        { background: '#FEF3C7', color: '#92400E' },
  email:      { background: '#F3F4F6', color: '#374151' },
  onboarding: { background: '#EBF5E8', color: '#1D8102' },
}

const OUTPUT_STYLE: Record<OutputType, React.CSSProperties> = {
  pdf:   { background: '#FEE2E2', color: '#991B1B' },
  email: { background: '#DBEAFE', color: '#1E40AF' },
  both:  { background: '#E0E7FF', color: '#3730A3' },
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Badge({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <span style={{ ...style, borderRadius: 3, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ── Filter pill group ─────────────────────────────────────────────────────────

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
        border: active ? '1px solid #0073BB' : '1px solid #D5DBDB',
        background: active ? '#E8F4FB' : '#fff',
        color: active ? '#0073BB' : '#687078',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const qc = useQueryClient()

  const [nameFilter,   setNameFilter]   = useState('')
  const [typeFilter,   setTypeFilter]   = useState<TemplateType | 'all'>('all')
  const [outputFilter, setOutputFilter] = useState<OutputType | 'all'>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [editorOpen,   setEditorOpen]   = useState(false)
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)

  const { data: tData, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await fetch('/api/templates', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ templates: Template[] }>
    },
  })

  const { data: cData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ companies: Company[] }>
    },
  })

  const templates: Template[] = tData?.templates ?? []
  const companies: Company[]  = cData?.companies  ?? []

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (nameFilter   && !t.name.toLowerCase().includes(nameFilter.toLowerCase())) return false
      if (typeFilter   !== 'all' && t.type        !== typeFilter)   return false
      if (outputFilter !== 'all' && t.output_type !== outputFilter) return false
      if (companyFilter !== 'all' && t.company_id !== companyFilter) return false
      return true
    })
  }, [templates, nameFilter, typeFilter, outputFilter, companyFilter])

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['templates'] })
  }

  async function handleDelete(t: Template, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return
    await fetch(`/api/templates/${t.id}`, { method: 'DELETE', credentials: 'include' })
    invalidate()
  }

  function openNew() {
    setEditTemplate(null)
    setEditorOpen(true)
  }

  function openEdit(t: Template) {
    setEditTemplate(t)
    setEditorOpen(true)
  }

  if (editorOpen) {
    return (
      <TemplateEditorDynamic
        template={editTemplate as TemplateEditorProps['template']}
        companies={companies}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { invalidate(); setEditorOpen(false) }}
      />
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text1)' }}>
          Templates
        </h1>
        <button
          onClick={openNew}
          style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {/* Name search */}
        <input
          type="text"
          placeholder="Filter by name…"
          value={nameFilter}
          onChange={e => setNameFilter(e.target.value)}
          style={{
            height: 34, border: '1px solid var(--border)', borderRadius: 6,
            padding: '0 12px', fontSize: 13, width: 220, background: '#fff',
          }}
        />

        {/* Type pills */}
        <div className="flex gap-1.5 flex-wrap">
          <FilterPill label="All Types" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
          {(['proposal', 'contract', 'nda', 'mou', 'invoice', 'email', 'onboarding'] as TemplateType[]).map(t => (
            <FilterPill key={t} label={TYPE_LABELS[t]} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
          ))}
        </div>

        {/* Output filter */}
        <div className="flex gap-1.5">
          <FilterPill label="PDF"   active={outputFilter === 'pdf'}   onClick={() => setOutputFilter(outputFilter === 'pdf'   ? 'all' : 'pdf')} />
          <FilterPill label="Email" active={outputFilter === 'email'} onClick={() => setOutputFilter(outputFilter === 'email' ? 'all' : 'email')} />
        </div>

        {/* Company filter */}
        {companies.length > 1 && (
          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            style={{ height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', fontSize: 13, background: '#fff', color: 'var(--text1)' }}
          >
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 1fr 40px',
          padding: '8px 16px', borderBottom: '1px solid var(--border)',
          background: '#FAFBFC',
        }}>
          {['Name', 'Type', 'Output', 'Company', 'Version', 'Updated', ''].map(h => (
            <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
          ))}
        </div>

        {isLoading ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            {nameFilter || typeFilter !== 'all' || outputFilter !== 'all'
              ? 'No templates match the filters.'
              : 'No templates yet. Create one to get started.'}
          </div>
        ) : (
          filtered.map((t, i) => (
            <div
              key={t.id}
              onClick={() => openEdit(t)}
              style={{
                display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 1fr 40px',
                padding: '11px 16px', cursor: 'pointer', alignItems: 'center',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFB')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {t.output_type === 'email'
                  ? <Mail size={14} color="#9CA3AF" style={{ flexShrink: 0 }} />
                  : <FileText size={14} color="#9CA3AF" style={{ flexShrink: 0 }} />
                }
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
              </div>

              {/* Type */}
              <div><Badge label={TYPE_LABELS[t.type]} style={TYPE_STYLE[t.type]} /></div>

              {/* Output */}
              <div><Badge label={t.output_type.toUpperCase()} style={OUTPUT_STYLE[t.output_type]} /></div>

              {/* Company */}
              <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.company_name}
              </span>

              {/* Version */}
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 12, color: 'var(--text2)' }}>
                v{t.version}
              </span>

              {/* Updated */}
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 12, color: 'var(--text2)' }}>
                {fmtDate(t.updated_at)}
              </span>

              {/* Delete */}
              <button
                onClick={e => handleDelete(t, e)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text3)', display: 'flex', alignItems: 'center' }}
                title="Delete template"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer count */}
      {!isLoading && templates.length > 0 && (
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
          {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
