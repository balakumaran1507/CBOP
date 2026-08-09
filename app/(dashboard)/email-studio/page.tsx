'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Mail, Code2, Activity, LayoutGrid, Eye, X } from 'lucide-react'
import dynamic from 'next/dynamic'

import type { EmailStudioEditorProps } from './editor'

const EmailStudioEditorDynamic = dynamic<EmailStudioEditorProps>(
  () => import('./editor'),
  { ssr: false, loading: () => null }
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'campaign' | 'hiring' | 'transactional' | 'document' | 'internal' | 'onboarding'
type ContentMode = 'richtext' | 'html'

export interface EmailDesign {
  id: string
  company_id: string | null
  company_name?: string
  name: string
  subject: string
  category: Category
  content_mode: ContentMode
  variables: string[]
  is_global: boolean
  updated_at: string
}

interface Company { id: string; name: string }

interface SendLogRow {
  id: string
  company_id: string | null
  kind: string
  to_email: string
  from_email: string
  subject: string
  status: string
  design_name: string | null
  created_at: string
  has_snapshot: boolean
  opened_at: string | null
  open_count: number
  clicked_at: string | null
  click_count: number
}

interface SendLogDetail extends SendLogRow {
  rendered_html: string | null
  attachment_refs: Array<{ type: string; id: string; name?: string }> | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<Category, string> = {
  campaign: 'Campaign', hiring: 'Hiring', transactional: 'Transactional',
  document: 'Document', internal: 'Internal', onboarding: 'Onboarding',
}

const CATEGORY_STYLE: Record<Category, React.CSSProperties> = {
  campaign:       { background: '#E0E7FF', color: '#3730A3' },
  hiring:         { background: '#EBF5E8', color: '#1D8102' },
  transactional:  { background: '#E8F4FB', color: '#0073BB' },
  document:       { background: '#FEE2E2', color: '#991B1B' },
  internal:       { background: '#F3F4F6', color: '#374151' },
  onboarding:     { background: '#FEF3C7', color: '#92400E' },
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  sent:       { background: '#EBF5E8', color: '#1D8102' },
  failed:     { background: '#FEE2E2', color: '#991B1B' },
  blocked:    { background: '#FEE2E2', color: '#991B1B' },
  suppressed: { background: '#F3F4F6', color: '#6B7280' },
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Badge({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <span style={{ ...style, borderRadius: 3, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

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

function TabButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--blue)' : 'transparent',
        color: active ? '#fff' : 'var(--text2)',
      }}
    >
      {icon} {label}
    </button>
  )
}

function SendSnapshotModal({ loading, entry, onClose }: { loading: boolean; entry: SendLogDetail | null; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: '100%', maxWidth: 760, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry?.subject ?? 'Loading…'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              To {entry?.to_email ?? '-'} · From {entry?.from_email ?? '-'} · {entry ? fmtDate(entry.created_at) : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', flexShrink: 0, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
          {loading || !entry ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Loading…</div>
          ) : entry.rendered_html ? (
            <iframe
              srcDoc={entry.rendered_html}
              sandbox=""
              style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}
            />
          ) : (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>No snapshot stored for this send.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailStudioPage() {
  const qc = useQueryClient()

  const [tab, setTab] = useState<'designs' | 'activity'>('designs')
  const [nameFilter, setNameFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<Category | 'all'>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editDesign, setEditDesign] = useState<EmailDesign | null>(null)
  const [viewLogId, setViewLogId] = useState<string | null>(null)

  const { data: dData, isLoading: designsLoading } = useQuery({
    queryKey: ['email-designs', categoryFilter],
    queryFn: async () => {
      const params = categoryFilter !== 'all' ? `?category=${categoryFilter}` : ''
      const res = await fetch(`/api/email-designs${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ designs: EmailDesign[] }>
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

  const { data: lData, isLoading: logLoading } = useQuery({
    queryKey: ['email-send-log'],
    queryFn: async () => {
      const res = await fetch('/api/email-send-log', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ log: SendLogRow[] }>
    },
    enabled: tab === 'activity',
  })

  const { data: vData, isLoading: viewLoading } = useQuery({
    queryKey: ['email-send-log', viewLogId],
    queryFn: async () => {
      const res = await fetch(`/api/email-send-log/${viewLogId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ entry: SendLogDetail }>
    },
    enabled: !!viewLogId,
  })

  const designs: EmailDesign[] = dData?.designs ?? []
  const companies: Company[]   = cData?.companies ?? []
  const log: SendLogRow[]      = lData?.log ?? []

  const filtered = useMemo(() => {
    return designs.filter(d => {
      if (nameFilter && !d.name.toLowerCase().includes(nameFilter.toLowerCase())) return false
      return true
    })
  }, [designs, nameFilter])

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['email-designs'] })
  }

  async function handleDelete(d: EmailDesign, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return
    await fetch(`/api/email-designs/${d.id}`, { method: 'DELETE', credentials: 'include' })
    invalidate()
  }

  function openNew() {
    setEditDesign(null)
    setEditorOpen(true)
  }

  function openEdit(d: EmailDesign) {
    setEditDesign(d)
    setEditorOpen(true)
  }

  if (editorOpen) {
    return (
      <EmailStudioEditorDynamic
        design={editDesign}
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
        <div>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text1)' }}>
            Email Studio
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
            Design once, send everywhere - Documents, Campaigns, Hiring, and automations all pull from here.
          </p>
        </div>
        {tab === 'designs' && (
          <button
            onClick={openNew}
            style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            + New Design
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
        <TabButton label="Designs" icon={<LayoutGrid size={14} />} active={tab === 'designs'} onClick={() => setTab('designs')} />
        <TabButton label="Activity" icon={<Activity size={14} />} active={tab === 'activity'} onClick={() => setTab('activity')} />
      </div>

      {tab === 'designs' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <input
              type="text"
              placeholder="Filter by name…"
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              style={{ height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: '0 12px', fontSize: 13, width: 220, background: '#fff' }}
            />
            <div className="flex gap-1.5 flex-wrap">
              <FilterPill label="All" active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} />
              {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
                <FilterPill key={cat} label={CATEGORY_LABELS[cat]} active={categoryFilter === cat} onClick={() => setCategoryFilter(cat)} />
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 40px',
              padding: '8px 16px', borderBottom: '1px solid var(--border)', background: '#FAFBFC',
            }}>
              {['Name', 'Category', 'Mode', 'Company', 'Updated', ''].map(h => (
                <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
              ))}
            </div>

            {designsLoading ? (
              <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
                {nameFilter || categoryFilter !== 'all' ? 'No designs match the filters.' : 'No designs yet. Create one to get started.'}
              </div>
            ) : (
              filtered.map((d, i) => (
                <div
                  key={d.id}
                  onClick={() => openEdit(d)}
                  style={{
                    display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 40px',
                    padding: '11px 16px', cursor: 'pointer', alignItems: 'center',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFB')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Mail size={14} color="#9CA3AF" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.name}
                    </span>
                    {d.is_global && <Badge label="GLOBAL" style={{ background: '#EDE9FE', color: '#5B21B6' }} />}
                  </div>
                  <div><Badge label={CATEGORY_LABELS[d.category]} style={CATEGORY_STYLE[d.category]} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text2)' }}>
                    {d.content_mode === 'html' ? <Code2 size={12} /> : <Mail size={12} />}
                    {d.content_mode === 'html' ? 'HTML' : 'Rich Text'}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.company_name ?? '-'}
                  </span>
                  <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 12, color: 'var(--text2)' }}>
                    {fmtDate(d.updated_at)}
                  </span>
                  <button
                    onClick={e => handleDelete(d, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text3)', display: 'flex', alignItems: 'center' }}
                    title="Delete design"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          {!designsLoading && designs.length > 0 && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
              {filtered.length} of {designs.length} design{designs.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr 1.2fr 40px',
            padding: '8px 16px', borderBottom: '1px solid var(--border)', background: '#FAFBFC',
          }}>
            {['To', 'Subject', 'Design', 'Kind', 'Status', 'Engagement', 'Sent', ''].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
            ))}
          </div>
          {logLoading ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Loading…</div>
          ) : log.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>No sends yet.</div>
          ) : (
            log.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr 1fr 1.2fr 40px',
                  padding: '10px 16px', alignItems: 'center',
                  borderBottom: i < log.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.to_email}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.design_name ?? '-'}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'capitalize' }}>{r.kind}</span>
                <div><Badge label={r.status.toUpperCase()} style={STATUS_STYLE[r.status] ?? { background: '#F3F4F6', color: '#6B7280' }} /></div>
                <span style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 6 }}>
                  {r.opened_at ? <span style={{ color: '#1D8102' }}>Opened{r.open_count > 1 ? ` x${r.open_count}` : ''}</span> : (r.kind === 'campaign' ? <span style={{ color: '#AAB5BB' }}>Not opened</span> : null)}
                  {r.clicked_at ? <span style={{ color: '#0073BB' }}>· Clicked{r.click_count > 1 ? ` x${r.click_count}` : ''}</span> : null}
                </span>
                <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 11, color: 'var(--text3)' }}>{fmtDate(r.created_at)}</span>
                {r.has_snapshot ? (
                  <button
                    onClick={() => setViewLogId(r.id)}
                    title="View exactly what was sent"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text3)', display: 'flex', alignItems: 'center' }}
                  >
                    <Eye size={14} />
                  </button>
                ) : <span />}
              </div>
            ))
          )}
        </div>
      )}

      {viewLogId && (
        <SendSnapshotModal
          loading={viewLoading}
          entry={vData?.entry ?? null}
          onClose={() => setViewLogId(null)}
        />
      )}
    </div>
  )
}
