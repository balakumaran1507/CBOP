'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, Settings, ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import { EmailDesignPicker } from '../email-studio/design-picker'
import { AttachmentPicker } from '../email-studio/attachment-picker'

interface DocTemplate {
  id: string
  name: string
  doc_type: string
  tags: string[]
  canvas_width: number
  canvas_height: number
}

interface Company { id: string; name: string }

interface Props {
  template: DocTemplate
  onClose: () => void
  onGenerated: () => void
}

type ParsedRow = Record<string, string>

export function GenerateSlideOver({ template, onClose, onGenerated }: Props) {
  const [step, setStep]             = useState<'upload' | 'map' | 'confirm' | 'generating' | 'done'>('upload')
  const [rows, setRows]             = useState<ParsedRow[]>([])
  const [columns, setColumns]       = useState<string[]>([])
  const [mapping, setMapping]       = useState<Record<string, string>>({}) // tag → column
  const [batchName,     setBatchName]     = useState(`${template.name} - Batch`)
  const [sendEmail,     setSendEmail]     = useState(false)
  const [emailDesignId, setEmailDesignId] = useState<string | null>(null)
  const [extraAttachmentIds, setExtraAttachmentIds] = useState<string[]>([])
  const [companies, setCompanies]   = useState<Company[]>([])
  const [batchId, setBatchId]       = useState<string | null>(null)
  const [progress, setProgress]     = useState({ done: 0, total: 0, status: 'pending' })
  const [error, setError]           = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Pre-send preview ──────────────────────────────────────────────────────
  const [previewIndex, setPreviewIndex]   = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewPdf, setPreviewPdf]       = useState('')
  const [previewSubject, setPreviewSubject] = useState('')
  const [previewEmailHtml, setPreviewEmailHtml] = useState('')
  const [previewSendLoading, setPreviewSendLoading] = useState(false)
  const [previewNotice, setPreviewNotice] = useState('')

  // ── Daily send-cap visibility ──────────────────────────────────────────────
  const [sendCap, setSendCap] = useState<{ from: string | null; sentToday: number; cap: number } | null>(null)
  useEffect(() => {
    if (!sendEmail) return
    fetch(`/api/documents/templates/${template.id}/send-cap`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setSendCap)
  }, [sendEmail, template.id])

  useEffect(() => {
    fetch('/api/companies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { companies: [] })
      .then((d: { companies: Company[] }) => setCompanies(d.companies ?? []))
  }, [])

  // ── File parsing ──────────────────────────────────────────────────────────
  const parseFile = useCallback(async (file: File) => {
    setError('')
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'csv' || ext === 'txt') {
      const { default: Papa } = await import('papaparse')
      Papa.parse<ParsedRow>(file, {
        header: true, skipEmptyLines: true,
        complete: result => {
          if (result.errors.length && !result.data.length) {
            setError('Could not parse CSV file')
            return
          }
          const cols = result.meta.fields ?? []
          setColumns(cols)
          setRows(result.data as ParsedRow[])
          buildAutoMapping(cols)
          setStep('map')
        },
        error: (err: Error) => setError(err.message),
      })
    } else if (['xlsx', 'xls', 'ods'].includes(ext ?? '')) {
      const XLSX = await import('xlsx')
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: '' })
      if (!data.length) { setError('Empty spreadsheet'); return }
      const cols = Object.keys(data[0])
      setColumns(cols)
      setRows(data.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))))
      buildAutoMapping(cols)
      setStep('map')
    } else {
      setError('Supported formats: CSV, XLSX, XLS, ODS')
    }
  }, [template.tags])

  const buildAutoMapping = (cols: string[]) => {
    const m: Record<string, string> = {}
    template.tags.forEach(tag => {
      const match = cols.find(c =>
        c.toLowerCase() === tag.toLowerCase() ||
        c.toLowerCase().replace(/\s+/g, '_') === tag.toLowerCase()
      )
      if (match) m[tag] = match
    })
    setMapping(m)
  }

  // ── Preview first row with current mapping ────────────────────────────────
  const previewRow = rows[0] ?? {}
  const previewData = Object.fromEntries(
    template.tags.map(tag => [tag, mapping[tag] ? previewRow[mapping[tag]] ?? '' : ''])
  )

  // ── Build recipients array for API ────────────────────────────────────────
  const buildRecipients = (): ParsedRow[] => {
    return rows.map(row => {
      const recipient: ParsedRow = {}
      template.tags.forEach(tag => {
        if (mapping[tag]) recipient[tag] = row[mapping[tag]] ?? ''
      })
      // Keep email + name columns even if not mapped as a tag
      if (!recipient.email && row.email)   recipient.email = row.email
      if (!recipient.name  && row.name)    recipient.name  = row.name
      if (!recipient.name  && row.Name)    recipient.name  = row.Name
      if (!recipient.email && row.Email)   recipient.email = row.Email
      return recipient
    })
  }

  // ── Duplicate-email detection (catches accidental double-sends before they happen) ──
  const duplicateEmails = (() => {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const r of buildRecipients()) {
      const email = (r.email || '').trim().toLowerCase()
      if (!email) continue
      if (seen.has(email)) dupes.add(email)
      seen.add(email)
    }
    return [...dupes]
  })()

  // ── Pre-send preview: one recipient among the whole batch, before committing ──
  const loadPreview = async () => {
    const recipient = buildRecipients()[previewIndex]
    if (!recipient) return
    setPreviewLoading(true); setError(''); setPreviewNotice('')
    setPreviewPdf(''); setPreviewSubject(''); setPreviewEmailHtml('')
    try {
      const res = await fetch(`/api/documents/templates/${template.id}/preview`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, email_design_id: sendEmail ? emailDesignId : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Preview failed'); return }
      setPreviewPdf(data.pdf_base64)
      setPreviewSubject(data.email_subject || '')
      setPreviewEmailHtml(data.email_html || '')
    } finally { setPreviewLoading(false) }
  }

  const sendPreviewToMe = async () => {
    const recipient = buildRecipients()[previewIndex]
    if (!recipient || !emailDesignId) return
    setPreviewSendLoading(true); setError(''); setPreviewNotice('')
    try {
      const res = await fetch(`/api/documents/templates/${template.id}/preview-send`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, email_design_id: emailDesignId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Preview send failed'); return }
      setPreviewNotice(`Sent to ${data.sentTo} - using ${recipient.name || recipient.email || 'this recipient'}'s real data.`)
    } finally { setPreviewSendLoading(false) }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (sendEmail && !emailDesignId) { setError('Choose or create an email design before sending.'); return }
    setError('')
    setStep('generating')
    try {
      const res = await fetch(`/api/documents/templates/${template.id}/generate`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_name:            batchName,
          recipients:            buildRecipients(),
          send_email:            sendEmail,
          email_design_id:       emailDesignId,
          extra_attachment_ids:  extraAttachmentIds,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBatchId(data.batch_id)
      setProgress({ done: 0, total: rows.length, status: 'generating' })
      pollRef.current = setInterval(() => pollStatus(data.batch_id), 2000)
    } catch (err: any) {
      setError(err.message)
      setStep('confirm')
    }
  }

  const pollStatus = async (id: string) => {
    try {
      const res = await fetch(`/api/documents/batches/${id}`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      setProgress({ done: data.done_count, total: data.total_count, status: data.status })
      if (data.status === 'done' || data.status === 'failed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setStep('done')
      }
    } catch { /* ignore */ }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  // ── Download ZIP or individual PDFs ──────────────────────────────────────
  const downloadAll = async () => {
    if (!batchId) return
    const res  = await fetch(`/api/documents/batches/${batchId}`, { credentials: 'include' })
    const data = await res.json()
    for (const doc of data.documents ?? []) {
      if (!doc.has_pdf) continue
      const pdfRes = await fetch(`/api/documents/generated/${doc.id}/pdf`, { credentials: 'include' })
      const blob   = await pdfRes.blob()
      const url    = URL.createObjectURL(blob)
      const a      = document.createElement('a')
      a.href       = url
      a.download   = `${doc.recipient_name || doc.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      await new Promise(r => setTimeout(r, 200)) // stagger downloads
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />

      <div style={{ width: 560, background: '#fff', display: 'flex', flexDirection: 'column', height: '100%', boxShadow: '-4px 0 24px rgba(0,0,0,0.2)' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text1)', marginBottom: 2 }}>
            Generate Documents
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>Template: <strong>{template.name}</strong></p>
        </div>

        {/* Step indicators */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, flexShrink: 0 }}>
          {[
            { key: 'upload',     label: '1. Upload' },
            { key: 'map',        label: '2. Map Fields' },
            { key: 'confirm',    label: '3. Confirm' },
            { key: 'generating', label: '4. Generating' },
          ].map(s => {
            const steps = ['upload', 'map', 'confirm', 'generating', 'done']
            const current = steps.indexOf(step)
            const me      = steps.indexOf(s.key)
            return (
              <span key={s.key} style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 20,
                background: current === me ? 'var(--blue)' : current > me ? '#E8F5E9' : 'var(--bg)',
                color: current === me ? '#fff' : current > me ? 'var(--green)' : 'var(--text3)',
                fontWeight: current === me ? 600 : 400,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {current > me && <CheckCircle2 size={12} />}{s.label}
              </span>
            )
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* ── STEP 1: Upload ── */}
          {step === 'upload' && (
            <div>
              <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 20 }}>
                Upload a CSV or Excel file. Each row will generate one document.
                Column headers should match the template tags listed below.
              </p>

              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>EXPECTED TAGS</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {template.tags.map(tag => (
                    <span key={tag} style={{
                      background: '#EBF8FF', border: '1px solid var(--blue)',
                      borderRadius: 4, padding: '2px 8px',
                      fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--blue)',
                    }}>
                      {`{{${tag}}}`}
                    </span>
                  ))}
                  {template.tags.length === 0 && (
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}>No tags defined on this template</span>
                  )}
                </div>
              </div>

              <label style={{
                display: 'block', border: '2px dashed var(--border)',
                borderRadius: 8, padding: '40px 24px', textAlign: 'center',
                cursor: 'pointer', color: 'var(--text2)',
              }}>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><Upload size={32} /></div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Click to upload</p>
                <p style={{ fontSize: 12, color: 'var(--text3)' }}>CSV, XLSX, XLS, ODS</p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,.ods,.txt"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }}
                />
              </label>

              {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</p>}

              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 16 }}>
                CSV tip: first row must be column headers. Recommended column: <code>name</code>, <code>email</code>
              </p>
            </div>
          )}

          {/* ── STEP 2: Map ── */}
          {step === 'map' && (
            <div>
              <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 4 }}>
                {rows.length} rows loaded from file.
                Map each template tag to a CSV column.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
                Auto-matched where column names match tag names.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {template.tags.map(tag => (
                  <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: 12,
                      color: 'var(--blue)', background: '#EBF8FF',
                      border: '1px solid var(--blue)', borderRadius: 4,
                      padding: '4px 8px', minWidth: 140, whiteSpace: 'nowrap',
                    }}>
                      {`{{${tag}}}`}
                    </span>
                    <span style={{ color: 'var(--text3)', fontSize: 16 }}>→</span>
                    <select
                      value={mapping[tag] ?? ''}
                      onChange={e => setMapping(prev => ({ ...prev, [tag]: e.target.value }))}
                      style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text1)' }}
                    >
                      <option value="">(skip)</option>
                      {columns.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* Duplicate-recipient warning - catches the same email appearing twice
                  in the upload before it causes an accidental double-send. */}
              {duplicateEmails.length > 0 && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: 12, marginBottom: 20 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>
                    {duplicateEmails.length} email{duplicateEmails.length !== 1 ? 's' : ''} appear{duplicateEmails.length === 1 ? 's' : ''} more than once in this file
                  </p>
                  <p style={{ fontSize: 12, color: '#92400E' }}>
                    {duplicateEmails.slice(0, 5).join(', ')}{duplicateEmails.length > 5 ? ` +${duplicateEmails.length - 5} more` : ''} - each will get a separate email unless you dedupe the file first.
                  </p>
                </div>
              )}

              {/* Preview */}
              {rows.length > 0 && (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>PREVIEW - Row 1</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {template.tags.map(tag => (
                      <div key={tag} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                        <span style={{ color: 'var(--text3)', fontFamily: 'IBM Plex Mono, monospace', minWidth: 120 }}>{`{{${tag}}}`}</span>
                        <span style={{ color: 'var(--text1)', fontWeight: 500 }}>
                          {previewData[tag] || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>empty</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setStep('upload')}
                  style={{ flex: 1, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: '9px', fontSize: 14, cursor: 'pointer', color: 'var(--text1)' }}
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  style={{ flex: 2, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px', fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === 'confirm' && (
            <div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Generation Summary</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text2)' }}>
                  <div>Template: <strong style={{ color: 'var(--text1)' }}>{template.name}</strong></div>
                  <div>Documents: <strong style={{ color: 'var(--text1)', fontFamily: 'IBM Plex Mono, monospace' }}>{rows.length}</strong></div>
                  <div>Fields mapped: <strong style={{ color: 'var(--text1)' }}>{Object.values(mapping).filter(Boolean).length} / {template.tags.length}</strong></div>
                  <div>Canvas: <strong style={{ color: 'var(--text1)', fontFamily: 'IBM Plex Mono, monospace' }}>{template.canvas_width}×{template.canvas_height}px</strong></div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>BATCH NAME</label>
                <input
                  value={batchName} onChange={e => setBatchName(e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: sendEmail ? 16 : 24 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)}
                    style={{ marginTop: 2, accentColor: 'var(--blue)', width: 16, height: 16 }}
                  />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text1)' }}>Send PDF via email</p>
                    <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                      Requires an <code>email</code> column in your file. Uses the company sender from the template.
                    </p>
                    {sendEmail && sendCap?.from && (
                      <p style={{
                        fontSize: 11, marginTop: 6, fontFamily: 'IBM Plex Mono, monospace',
                        color: sendCap.sentToday + rows.length > sendCap.cap ? 'var(--red)' : 'var(--text3)',
                      }}>
                        {sendCap.sentToday}/{sendCap.cap} sent today from {sendCap.from}
                        {sendCap.sentToday + rows.length > sendCap.cap && ` - this batch (${rows.length}) would exceed the daily cap`}
                      </p>
                    )}
                  </div>
                </label>
              </div>

              {sendEmail && (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>EMAIL DESIGN</label>
                    <EmailDesignPicker value={emailDesignId} onChange={setEmailDesignId} companies={companies} placeholder="Choose or create an email design…" />
                    <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      Opens the full Email Studio editor to design or pick a reusable email. Merge fields like <code style={{ fontSize: 11 }}>{'{{name}}'}</code> get filled in per recipient - the PDF is attached automatically.
                    </p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>EXTRA ATTACHMENTS (OPTIONAL)</label>
                    <AttachmentPicker selectedIds={extraAttachmentIds} onChange={setExtraAttachmentIds} companyId={null} />
                    <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      Attached to every email in this batch, alongside each recipient&apos;s own generated PDF - a brochure, T&amp;Cs, price list.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Pre-send preview: pick one recipient out of the whole batch ── */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', marginBottom: 10 }}>
                  Preview before sending - {rows.length} recipient{rows.length !== 1 ? 's' : ''} total
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <select
                    value={previewIndex}
                    onChange={e => setPreviewIndex(Number(e.target.value))}
                    style={{ flex: 1, minWidth: 160, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 13, background: '#fff' }}
                  >
                    {rows.map((_, i) => {
                      const r = buildRecipients()[i]
                      return <option key={i} value={i}>#{i + 1} of {rows.length} - {r?.name || r?.email || 'row ' + (i + 1)}</option>
                    })}
                  </select>
                  <button
                    onClick={loadPreview} disabled={previewLoading}
                    style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text1)', fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {previewLoading ? 'Rendering…' : 'Load Preview'}
                  </button>
                  {sendEmail && emailDesignId && (
                    <button
                      onClick={sendPreviewToMe} disabled={previewSendLoading}
                      title="Send this recipient's real rendering to your own inbox - the extra check if the preview alone isn't enough"
                      style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                    >
                      {previewSendLoading ? 'Sending…' : 'Email preview to me'}
                    </button>
                  )}
                </div>
                {previewNotice && <p style={{ fontSize: 12, color: 'var(--green)', marginBottom: 10 }}>{previewNotice}</p>}

                {(previewPdf || previewEmailHtml) && (
                  <div style={{ display: 'grid', gridTemplateColumns: previewEmailHtml ? '1fr 1fr' : '1fr', gap: 12 }}>
                    {previewPdf && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>PDF</p>
                        <iframe title="PDF preview" src={`data:application/pdf;base64,${previewPdf}`} style={{ width: '100%', height: 340, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
                      </div>
                    )}
                    {previewEmailHtml && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Email</p>
                        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}><strong>Subject:</strong> {previewSubject}</p>
                        <iframe title="Email preview" srcDoc={previewEmailHtml} sandbox="" style={{ width: '100%', height: 300, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setStep('map')}
                  style={{ flex: 1, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: '9px', fontSize: 14, cursor: 'pointer', color: 'var(--text1)' }}
                >
                  Back
                </button>
                <button
                  onClick={handleGenerate}
                  style={{ flex: 2, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
                >
                  Generate {rows.length} Document{rows.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Generating ── */}
          {step === 'generating' && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Settings size={40} /></div>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Generating PDFs…</p>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24 }}>
                Do not close this window. This may take a minute for large batches.
              </p>
              <div style={{ background: 'var(--bg)', borderRadius: 8, height: 10, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%', background: 'var(--blue)',
                  width: `${pct}%`, transition: 'width 0.5s',
                }} />
              </div>
              <p style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text2)' }}>
                {progress.done} / {progress.total} ({pct}%)
              </p>
            </div>
          )}

          {/* ── STEP 5: Done ── */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              {progress.status === 'done' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><CheckCircle2 size={48} color="var(--green)" /></div>
                  <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text1)', marginBottom: 8 }}>
                    {progress.done} documents generated!
                  </p>
                  {sendEmail && (
                    <p style={{ fontSize: 13, color: 'var(--green)', marginBottom: 20 }}>
                      Emails sent to all recipients with valid addresses.
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
                    <button
                      onClick={downloadAll}
                      style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Download All PDFs
                    </button>
                    <button
                      onClick={() => { onGenerated() }}
                      style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 20px', fontSize: 14, cursor: 'pointer', color: 'var(--text1)' }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><XCircle size={48} color="var(--red)" /></div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Generation failed</p>
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
                    Some documents may have been generated. Check the batch history.
                  </p>
                  <button
                    onClick={() => { onGenerated() }}
                    style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
