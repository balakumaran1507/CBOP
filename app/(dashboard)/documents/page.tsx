'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import { BatchDetailSlideOver } from './batch-detail-slide-over'

// Both slide-overs are client-only and load lazily - prevents xlsx/papaparse from
// bloating the initial page bundle and avoids SSR issues with those libraries.
const TemplateEditorSlideOver = dynamic(
  () => import('./template-editor-slide-over'),
  { ssr: false, loading: () => null }
)

const GenerateSlideOver = dynamic(
  () => import('./generate-slide-over').then(m => ({ default: m.GenerateSlideOver })),
  { ssr: false, loading: () => null }
)

interface DocTemplate {
  id: string
  name: string
  doc_type: string
  canvas_width: number
  canvas_height: number
  batch_count: number
  created_by_name: string
  updated_at: string
  tags: string[]
  background_path: string | null
  elements: TemplateElement[]
}

interface TemplateElement {
  id: string
  tag: string
  x: number
  y: number
  width: number
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  fill: string
  textAlign: 'left' | 'center' | 'right'
}

interface Batch {
  id: string
  name: string
  template_name: string
  status: string
  total_count: number
  done_count: number
  send_email: boolean
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  offer_letter: 'Offer Letter',
  certificate:  'Certificate',
  custom:       'Custom',
}

const STATUS_COLORS: Record<string, string> = {
  pending:    '#E8820C',
  generating: '#0073BB',
  done:       '#1D8102',
  failed:     '#D13212',
}

function statusDot(status: string) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8,
      borderRadius: '50%', background: STATUS_COLORS[status] ?? '#687078',
      marginRight: 6,
    }} />
  )
}

export default function DocumentsPage() {
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [batches,   setBatches]   = useState<Batch[]>([])
  const [filter,    setFilter]    = useState('')
  const [loading,   setLoading]   = useState(true)

  const [editorOpen,   setEditorOpen]   = useState(false)
  const [editTemplate, setEditTemplate] = useState<DocTemplate | null>(null)

  const [genOpen,      setGenOpen]      = useState(false)
  const [genTemplate,  setGenTemplate]  = useState<DocTemplate | null>(null)

  const [batchDetailId, setBatchDetailId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [tRes, bRes] = await Promise.all([
        fetch('/api/documents/templates', { credentials: 'include' }),
        fetch('/api/documents/batches',   { credentials: 'include' }),
      ])
      if (tRes.ok) setTemplates(await tRes.json())
      if (bRes.ok) setBatches(await bRes.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const filtered = templates.filter(t =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.doc_type.includes(filter.toLowerCase())
  )

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this template? All generated documents will also be removed.')) return
    await fetch(`/api/documents/templates/${id}`, { method: 'DELETE', credentials: 'include' })
    setTemplates(ts => ts.filter(t => t.id !== id))
  }

  return (
    <div style={{ padding: '24px 32px', backgroundColor: 'var(--bg)', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 26, fontWeight: 700, color: 'var(--text1)', marginBottom: 5 }}>
            Document Studio
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            Design offer letters and certificates, then generate PDFs in bulk from CSV data.
          </p>
        </div>
        <button
          onClick={() => { setEditTemplate(null); setEditorOpen(true) }}
          style={{
            background: 'var(--blue)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 2px 8px rgba(0,115,187,0.3)',
          }}
        >
          + New Template
        </button>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>

        {/* LEFT - Templates (60%) */}
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--text1)' }}>
              Templates
              {!loading && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 400, color: 'var(--text2)', marginLeft: 8 }}>({filtered.length})</span>}
            </h2>
            <input
              placeholder="Filter templates…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '6px 12px', fontSize: 13, color: 'var(--text1)',
                background: '#fff', width: 200,
              }}
            />
          </div>

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 220, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{
              background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
              padding: '56px 24px', textAlign: 'center', color: 'var(--text2)',
            }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>◫</div>
              <p style={{ marginBottom: 14, fontSize: 15 }}>No templates yet. Create your first one.</p>
              <button
                onClick={() => { setEditTemplate(null); setEditorOpen(true) }}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
              >
                + New Template
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {filtered.map(t => (
                <div key={t.id} style={{
                  background: '#fff', border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  {/* Preview thumbnail */}
                  <div style={{
                    height: 180, background: t.background_path
                      ? `url(/api/documents/backgrounds/${t.background_path}) center/cover`
                      : 'linear-gradient(135deg, #F2F3F3 0%, #D5DBDB 100%)',
                    position: 'relative',
                  }}>
                    {!t.background_path && (
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text3)', fontSize: 40,
                      }}>◫</div>
                    )}
                    <span style={{
                      position: 'absolute', top: 10, right: 10,
                      background: 'rgba(0,0,0,0.6)', color: '#fff',
                      fontSize: 11, borderRadius: 4, padding: '3px 9px', fontWeight: 500,
                    }}>
                      {TYPE_LABELS[t.doc_type] ?? t.doc_type}
                    </span>
                  </div>

                  {/* Card body */}
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text1)', marginBottom: 5 }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                      {t.tags.length} field{t.tags.length !== 1 ? 's' : ''} &middot; {t.batch_count} batch{t.batch_count !== 1 ? 'es' : ''}
                      &middot;&nbsp;<span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>{t.canvas_width}×{t.canvas_height}</span>
                    </div>
                    {t.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                        {t.tags.slice(0, 4).map(tag => (
                          <span key={tag} style={{
                            background: 'var(--bg)', border: '1px solid var(--border)',
                            borderRadius: 3, padding: '2px 6px', fontSize: 11,
                            fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text2)',
                          }}>
                            {`{{${tag}}}`}
                          </span>
                        ))}
                        {t.tags.length > 4 && (
                          <span style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 4px' }}>+{t.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => { setGenTemplate(t); setGenOpen(true) }}
                        style={{ flex: 1, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, padding: '7px 0', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
                      >
                        Generate
                      </button>
                      <button
                        onClick={() => { setEditTemplate(t); setEditorOpen(true) }}
                        style={{ flex: 1, background: 'transparent', color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 5, padding: '7px 0', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 5, padding: '7px 10px', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT - Recent Generations (40%) */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--text1)', marginBottom: 14 }}>
            Recent Generations
          </h2>
          {batches.length === 0 ? (
            <div style={{
              background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
              padding: '32px 24px', textAlign: 'center', color: 'var(--text2)', fontSize: 14,
            }}>
              No generations yet - pick a template and click Generate.
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                    {['Batch', 'Template', 'Status', 'Progress', 'Created'].map(h => (
                      <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr
                      key={b.id}
                      onClick={() => setBatchDetailId(b.id)}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text1)', fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.template_name}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {statusDot(b.status)}
                        <span style={{ color: STATUS_COLORS[b.status] ?? '#687078', textTransform: 'capitalize' }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text1)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 48, height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                            <div style={{
                              height: '100%',
                              width: b.total_count ? `${(b.done_count / b.total_count) * 100}%` : '0%',
                              background: STATUS_COLORS[b.status] ?? '#687078',
                              transition: 'width 0.3s',
                            }} />
                          </div>
                          {b.done_count}/{b.total_count}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text2)', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'nowrap' }}>
                        {new Date(b.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Overlays */}
      {editorOpen && (
        <TemplateEditorSlideOver
          template={editTemplate}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); loadData() }}
        />
      )}
      {genOpen && genTemplate && (
        <GenerateSlideOver
          template={genTemplate}
          onClose={() => setGenOpen(false)}
          onGenerated={() => { setGenOpen(false); loadData() }}
        />
      )}
      {batchDetailId && (
        <BatchDetailSlideOver
          batchId={batchDetailId}
          onClose={() => setBatchDetailId(null)}
          onChanged={loadData}
        />
      )}
    </div>
  )
}
