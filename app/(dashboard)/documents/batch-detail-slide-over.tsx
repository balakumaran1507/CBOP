'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Play, Pause, RotateCcw, CheckCircle2, XCircle, Clock, Loader2, Download } from 'lucide-react'

interface BatchItem {
  id: string
  seq: number
  recipient_data: Record<string, string>
  status: 'pending' | 'processing' | 'done' | 'failed'
  error_message: string | null
  document_generated_id: string | null
  email_sent: boolean | null
  has_pdf: boolean
  lifecycle_status: 'generated' | 'sent' | 'viewed' | 'acknowledged' | null
  viewed_at: string | null
  acknowledged_at: string | null
}

interface BatchDetail {
  id: string
  name: string
  template_name: string
  status: string
  total_count: number
  done_count: number
  send_email: boolean
  paused: boolean
  error_message: string | null
  created_at: string
}

interface Props {
  batchId: string
  onClose: () => void
  onChanged: () => void
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#E8820C', generating: '#0073BB', done: '#1D8102', failed: '#D13212',
}

const ITEM_STATUS: Record<BatchItem['status'], { color: string; icon: React.ReactNode; label: string }> = {
  pending:    { color: '#9CA3AF', icon: <Clock size={13} />,                          label: 'Pending' },
  processing: { color: '#0073BB', icon: <Loader2 size={13} className="animate-spin" />, label: 'Processing' },
  done:       { color: '#1D8102', icon: <CheckCircle2 size={13} />,                   label: 'Done' },
  failed:     { color: '#D13212', icon: <XCircle size={13} />,                        label: 'Failed' },
}

export function BatchDetailSlideOver({ batchId, onClose, onChanged }: Props) {
  const [batch, setBatch] = useState<BatchDetail | null>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const [bRes, iRes] = await Promise.all([
      fetch(`/api/documents/batches/${batchId}`, { credentials: 'include' }),
      fetch(`/api/documents/batches/${batchId}/items`, { credentials: 'include' }),
    ])
    if (bRes.ok) setBatch(await bRes.json())
    if (iRes.ok) { const d = await iRes.json(); setItems(d.items ?? []) }
    setLoading(false)
  }, [batchId])

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  useEffect(() => {
    // Stop polling once the batch is settled and not actively generating.
    if (batch && batch.status !== 'generating' && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [batch])

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'processing').length
  const failedCount  = items.filter(i => i.status === 'failed').length
  const doneCount    = items.filter(i => i.status === 'done').length

  const handleResume = async () => {
    setBusy(true); setNotice('')
    try {
      const res = await fetch(`/api/documents/batches/${batchId}/resume`, { method: 'POST', credentials: 'include' })
      if (!res.ok) { setNotice('Resume failed'); return }
      setNotice('Resuming - picking up where it left off.')
      if (!pollRef.current) pollRef.current = setInterval(load, 3000)
      load()
      onChanged()
    } finally { setBusy(false) }
  }

  const handlePause = async () => {
    setBusy(true); setNotice('')
    try {
      const res = await fetch(`/api/documents/batches/${batchId}/pause`, { method: 'POST', credentials: 'include' })
      if (!res.ok) { setNotice('Pause failed'); return }
      setNotice('Pausing - finishes the recipient currently in flight, then stops.')
      load()
      onChanged()
    } finally { setBusy(false) }
  }

  const handleRetry = async (all: boolean) => {
    if (!confirm(all ? 'Start a new batch resending to everyone in this list?' : `Start a new batch for the ${pendingCount + failedCount} recipient(s) not yet done?`)) return
    setBusy(true); setNotice('')
    try {
      const res = await fetch(`/api/documents/batches/${batchId}/duplicate${all ? '?all=true' : ''}`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setNotice(data.error || 'Retry failed'); return }
      setNotice('New batch started - close this and check Recent Generations.')
      onChanged()
    } finally { setBusy(false) }
  }

  const pct = batch?.total_count ? Math.round((batch.done_count / batch.total_count) * 100) : 0

  const handleExportCsv = () => {
    const header = ['name', 'email', 'status', 'error']
    const csvRows = items.map(item => [
      item.recipient_data.name ?? '',
      item.recipient_data.email ?? '',
      item.status,
      item.error_message ?? '',
    ])
    const escapeCsv = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const csv = [header, ...csvRows].map(row => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${(batch?.name ?? 'batch').replace(/[^a-z0-9 _-]/gi, '_')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: 560, maxWidth: '100%', background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 1 }}>
          <div>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 700, color: 'var(--text1)' }}>
              {batch?.name ?? 'Batch'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{batch?.template_name}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', display: 'flex' }}><X size={18} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Loading…</div>
        ) : !batch ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Not found.</div>
        ) : (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[batch.status] ?? '#687078' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_COLORS[batch.status] ?? '#687078', textTransform: 'capitalize' }}>
                  {batch.paused ? 'Paused' : batch.status}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {batch.done_count}/{batch.total_count}
                </span>
              </div>
              <div style={{ width: '100%', height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: STATUS_COLORS[batch.status] ?? '#687078', transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                <span>✓ {doneCount} sent</span>
                {failedCount > 0 && <span style={{ color: '#D13212' }}>✗ {failedCount} failed</span>}
                {pendingCount > 0 && <span>⋯ {pendingCount} remaining</span>}
              </div>
              {batch.error_message && (
                <p style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                  {batch.error_message}
                </p>
              )}
              {notice && <p style={{ fontSize: 12, color: 'var(--blue)', marginBottom: 12 }}>{notice}</p>}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(batch.status === 'generating' && !batch.paused) && (
                  <button onClick={handlePause} disabled={busy} style={btnStyle('#fff', 'var(--text1)', '1px solid var(--border)')}>
                    <Pause size={13} /> Pause
                  </button>
                )}
                {(pendingCount > 0 && (batch.paused || batch.status === 'failed' || batch.status === 'generating')) && (
                  <button onClick={handleResume} disabled={busy} style={btnStyle('var(--blue)', '#fff', 'none')}>
                    <Play size={13} /> Resume
                  </button>
                )}
                {(pendingCount + failedCount > 0) && (
                  <button onClick={() => handleRetry(false)} disabled={busy} style={btnStyle('#fff', 'var(--text1)', '1px solid var(--border)')}>
                    <RotateCcw size={13} /> Retry the {pendingCount + failedCount} not done - as new batch
                  </button>
                )}
                <button onClick={() => handleRetry(true)} disabled={busy} style={btnStyle('#fff', 'var(--text2)', '1px solid var(--border)')}>
                  <RotateCcw size={13} /> Resend to everyone - as new batch
                </button>
                <button onClick={handleExportCsv} disabled={items.length === 0} style={btnStyle('#fff', 'var(--text2)', '1px solid var(--border)')}>
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr 1.2fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                {['Recipient', 'Email', 'Status', 'Lifecycle'].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
                ))}
              </div>
              {items.map(item => {
                const st = ITEM_STATUS[item.status]
                return (
                  <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr 1.2fr', padding: '9px 20px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.recipient_data.name || item.recipient_data.candidate_name || '-'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.recipient_data.email || '-'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: st.color }} title={item.error_message ?? undefined}>
                      {st.icon} {st.label}
                    </span>
                    {item.document_generated_id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 10, textTransform: 'capitalize',
                          background: item.lifecycle_status === 'acknowledged' ? '#E6F4EA' : item.lifecycle_status === 'viewed' ? '#EBF4FB' : '#F2F3F3',
                          color: item.lifecycle_status === 'acknowledged' ? '#1D8102' : item.lifecycle_status === 'viewed' ? '#0073BB' : '#687078',
                        }}>
                          {item.lifecycle_status ?? 'generated'}
                        </span>
                        {item.lifecycle_status !== 'acknowledged' && (
                          <button
                            onClick={async () => {
                              await fetch(`/api/documents/generated/${item.document_generated_id}/acknowledge`, { method: 'PATCH', credentials: 'include' })
                              load()
                            }}
                            style={{ fontSize: 10.5, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            Mark acknowledged
                          </button>
                        )}
                      </div>
                    ) : <span />}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function btnStyle(bg: string, color: string, border: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, background: bg, color, border,
    borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  }
}
