'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type TemplateType = 'invoice' | 'proposal' | 'contract' | 'nda' | 'mou' | 'email' | 'onboarding'

interface Template {
  id: string
  company_id: string
  company_name: string
  name: string
  type: TemplateType
  content: string
  variables: string[]
  version: number
  updated_at: string
  created_at: string
}

interface TemplateVersion {
  id: string
  version: number
  content: string
  saved_at: string
}

interface Company { id: string; name: string; invoice_prefix: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SAMPLE_VARS: Record<string, string> = {
  client_name:         'Cyberdyne Systems Pvt. Ltd.',
  amount:              '₹1,50,000',
  date:                new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  company_name:        'Etherence IT Private Limited',
  service_description: 'Cybersecurity Penetration Testing Services',
  due_date:            new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  gstin:               '33AABCE1234F1Z5',
  gst_type:            'CGST + SGST',
  cgst:                '₹13,500',
  sgst:                '₹13,500',
  igst:                '₹27,000',
  amount_in_words:     'Rupees One Lakh Fifty Thousand Only',
  upi_id:              'etherence@hdfcbank',
}

function renderVars(content: string): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    SAMPLE_VARS[key] ? `<mark style="background:#FFF3CD;border-radius:2px;padding:0 2px;">${SAMPLE_VARS[key]}</mark>` : `<span style="color:#D13212;">[${key}]</span>`
  )
}

const TYPE_LABELS: Record<TemplateType, string> = {
  invoice:    'Invoice',
  proposal:   'Proposal',
  contract:   'Contract',
  nda:        'NDA',
  mou:        'MOU',
  email:      'Email',
  onboarding: 'Onboarding',
}

const TYPE_STYLE: Record<TemplateType, React.CSSProperties> = {
  invoice:    { backgroundColor: '#E8F4FB', color: '#0073BB' },
  proposal:   { backgroundColor: '#EBF5E8', color: '#1D8102' },
  contract:   { backgroundColor: '#F2F3F3', color: '#232F3E' },
  nda:        { backgroundColor: '#FEF8EE', color: '#E8820C' },
  mou:        { backgroundColor: '#FEF8EE', color: '#E8820C' },
  email:      { backgroundColor: '#F2F3F3', color: '#687078' },
  onboarding: { backgroundColor: '#EBF5E8', color: '#1D8102' },
}

const inputStyle: React.CSSProperties = {
  height: '36px', border: '1px solid var(--border)', borderRadius: '6px',
  outline: 'none', padding: '0 12px', fontSize: '0.875rem', width: '100%',
  fontFamily: 'var(--font-inter), sans-serif', backgroundColor: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '4px',
  color: 'var(--text2)', fontFamily: 'var(--font-inter), sans-serif',
}

// ── Type Badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: TemplateType }) {
  return (
    <span className="text-xs px-2 py-0.5 font-medium capitalize" style={{ ...TYPE_STYLE[type], borderRadius: '3px' }}>
      {TYPE_LABELS[type]}
    </span>
  )
}

// ── New Template Slide-over ───────────────────────────────────────────────────

function NewTemplateSlideOver({
  onClose, onSaved, companies,
}: {
  onClose: () => void
  onSaved: () => void
  companies: Company[]
}) {
  const [name,      setName]      = useState('')
  const [type,      setType]      = useState<TemplateType>('proposal')
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')
  const [content,   setContent]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim())  { setError('Name is required');       return }
    if (!companyId)    { setError('Company is required');    return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/templates', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, content, company_id: companyId }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to create'); return }
      onSaved(); onClose()
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '560px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
            New Template
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-auto">
          <div className="px-6 py-5 flex flex-col gap-4 flex-1">
            <div>
              <label style={labelStyle}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pentest Proposal" style={inputStyle} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Type</label>
                <select value={type} onChange={e => setType(e.target.value as TemplateType)} style={inputStyle}>
                  {(Object.keys(TYPE_LABELS) as TemplateType[]).map(t => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={inputStyle}>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col flex-1">
              <label style={labelStyle}>
                Content &nbsp;
                <span style={{ color: 'var(--text3)', fontWeight: 400 }}>
                  — use {'{{variable_name}}'} for dynamic values
                </span>
              </label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={'Dear {{client_name}},\n\nWe are pleased to present this proposal for {{service_description}}...'}
                style={{
                  ...inputStyle, height: 'auto', flexGrow: 1, minHeight: '320px',
                  padding: '12px', resize: 'none', lineHeight: 1.7,
                  fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: '0.82rem',
                }}
              />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
          <div className="px-6 py-4 flex-shrink-0 flex justify-end gap-3" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded" style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text1)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded font-medium text-white" style={{ backgroundColor: saving ? 'var(--text3)' : 'var(--blue)', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Template Detail Slide-over ────────────────────────────────────────────────

type DetailTab = 'preview' | 'edit' | 'history'

function TemplateDetailSlideOver({
  templateId, onClose, onSaved,
}: {
  templateId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [tab,        setTab]        = useState<DetailTab>('preview')
  const [editName,   setEditName]   = useState('')
  const [editType,   setEditType]   = useState<TemplateType>('proposal')
  const [editContent, setEditContent] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['template', templateId],
    queryFn: async () => {
      const res = await fetch(`/api/templates/${templateId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      return json as { template: Template; versions: TemplateVersion[] }
    },
  })

  const template: Template | undefined = data?.template
  const versions: TemplateVersion[] = data?.versions || []

  useEffect(() => {
    if (template) {
      setEditName(template.name)
      setEditType(template.type)
      setEditContent(template.content || '')
    }
  }, [template?.id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editName.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), type: editType, content: editContent }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to save'); return }
      onSaved(); setTab('preview')
    } catch { setError('Network error')
    } finally { setSaving(false) }
  }

  async function handleExportPdf() {
    setPdfLoading(true)
    try {
      const res = await fetch(`/api/templates/${templateId}/pdf`, { credentials: 'include' })
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${template?.name || 'template'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setPdfLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col" style={{ width: '620px', backgroundColor: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 min-w-0 mr-4">
            {template && <TypeBadge type={template.type} />}
            <h2 className="text-base font-semibold truncate" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
              {template?.name || '…'}
            </h2>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text2)', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', paddingLeft: '24px' }}>
          {(['preview', 'edit', 'history'] as DetailTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2.5 text-sm capitalize"
              style={{
                border: 'none', background: 'none', cursor: 'pointer',
                color: tab === t ? 'var(--blue)' : 'var(--text2)',
                borderBottom: tab === t ? '2px solid var(--blue)' : '2px solid transparent',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text3)' }}>Loading…</div>
        ) : !template ? null : (

          <>
            {/* Preview tab */}
            {tab === 'preview' && (
              <div className="flex flex-col flex-1 overflow-auto">
                <div className="px-6 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text3)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
                      Version {template.version} · Updated {fmtDate(template.updated_at)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
                      {'{{variables}}'} replaced with sample values
                    </p>
                  </div>
                  <button
                    onClick={handleExportPdf}
                    disabled={pdfLoading}
                    className="px-3 py-1.5 text-sm rounded font-medium text-white flex items-center gap-1.5"
                    style={{ backgroundColor: pdfLoading ? 'var(--text3)' : 'var(--blue)', border: 'none', cursor: pdfLoading ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                  >
                    {pdfLoading ? 'Exporting…' : '↓ Export PDF'}
                  </button>
                </div>
                <div
                  className="flex-1 mx-6 mb-6 p-5 overflow-auto"
                  style={{
                    border: '1px solid var(--border)', borderRadius: '6px',
                    fontFamily: 'var(--font-inter), sans-serif', fontSize: '0.9rem',
                    lineHeight: 1.8, color: 'var(--text1)', whiteSpace: 'pre-wrap',
                    backgroundColor: '#FAFBFC',
                  }}
                  dangerouslySetInnerHTML={{ __html: renderVars(template.content || '') }}
                />
              </div>
            )}

            {/* Edit tab */}
            {tab === 'edit' && (
              <form key={templateId} onSubmit={handleSave} className="flex flex-col flex-1 overflow-auto">
                <div className="px-6 py-5 flex flex-col gap-4 flex-1">
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={editType} onChange={e => setEditType(e.target.value as TemplateType)} style={inputStyle}>
                      {(Object.keys(TYPE_LABELS) as TemplateType[]).map(t => (
                        <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col flex-1">
                    <label style={labelStyle}>
                      Content &nbsp;
                      <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— {'{{variable_name}}'} for dynamic values</span>
                    </label>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      style={{
                        ...inputStyle, height: 'auto', flexGrow: 1, minHeight: '340px',
                        padding: '12px', resize: 'none', lineHeight: 1.7,
                        fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: '0.82rem',
                      }}
                    />
                  </div>
                  {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
                </div>
                <div className="px-6 py-4 flex-shrink-0 flex justify-end gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <button type="button" onClick={() => { setTab('preview'); setError('') }} className="px-4 py-2 text-sm rounded" style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text1)', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded font-medium text-white" style={{ backgroundColor: saving ? 'var(--text3)' : 'var(--blue)', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {/* History tab */}
            {tab === 'history' && (
              <div className="flex flex-col flex-1 overflow-auto px-6 py-5">
                {versions.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text3)' }}>No previous versions saved yet. Versions are saved automatically when content is edited.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {versions.map((v) => (
                      <VersionRow key={v.id} version={v} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Version Row ───────────────────────────────────────────────────────────────

function VersionRow({ version }: { version: TemplateVersion }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
        style={{ background: '#FAFBFC', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)', fontWeight: 500 }}>
          Version {version.version}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: '0.75rem', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
          {new Date(version.saved_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {' '}{expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: '12px 16px', borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: '0.8rem',
            color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.7,
            maxHeight: '240px', overflow: 'auto', backgroundColor: '#fff',
          }}
        >
          {version.content || '(empty)'}
        </div>
      )}
    </div>
  )
}

// ── Templates Page ────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const qc = useQueryClient()

  const [filter,          setFilter]          = useState('')
  const [showNew,         setShowNew]          = useState(false)
  const [selectedId,      setSelectedId]       = useState<string | null>(null)

  const { data: templateData, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await fetch('/api/templates', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load templates')
      return res.json() as Promise<{ templates: Template[] }>
    },
  })

  const { data: companyData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await fetch('/api/companies', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ companies: Company[] }>
    },
  })

  const templates: Template[]  = templateData?.templates  || []
  const companies: Company[]   = companyData?.companies   || []

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q)
    )
  }, [templates, filter])

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['templates'] })
    qc.invalidateQueries({ queryKey: ['template', selectedId] })
  }

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <h1
          className="text-xl font-semibold"
          style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}
        >
          Templates
        </h1>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm rounded font-medium text-white"
          style={{ backgroundColor: 'var(--blue)', border: 'none', cursor: 'pointer' }}
        >
          + New Template
        </button>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter templates by name or type…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            ...inputStyle,
            width: '320px',
            backgroundColor: '#fff',
          }}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded" style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        {/* Table header */}
        <div
          className="grid text-xs font-medium px-4 py-2.5"
          style={{
            gridTemplateColumns: '2fr 1fr 1fr 1fr',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
            backgroundColor: '#FAFBFC',
          }}
        >
          <span>Name</span>
          <span>Type</span>
          <span>Version</span>
          <span>Last Updated</span>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--text3)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--text3)' }}>
            {filter ? 'No templates match the filter.' : 'No templates yet. Create one to get started.'}
          </div>
        ) : (
          filtered.map((t, i) => (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className="grid px-4 py-3 cursor-pointer transition-colors"
              style={{
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFB')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                {t.name}
              </span>
              <span>
                <TypeBadge type={t.type} />
              </span>
              <span
                className="text-sm"
                style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}
              >
                v{t.version}
              </span>
              <span
                className="text-sm"
                style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text2)' }}
              >
                {fmtDate(t.updated_at)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Slide-overs */}
      {showNew && (
        <NewTemplateSlideOver
          onClose={() => setShowNew(false)}
          onSaved={() => { invalidate(); setShowNew(false) }}
          companies={companies}
        />
      )}

      {selectedId && (
        <TemplateDetailSlideOver
          key={selectedId}
          templateId={selectedId}
          onClose={() => setSelectedId(null)}
          onSaved={() => { invalidate() }}
        />
      )}
    </div>
  )
}
