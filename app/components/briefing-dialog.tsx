'use client'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Send } from 'lucide-react'

// ─── briefing dialog ─────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface BriefingConfig {
  send_time: string
  active_days: number[]
  is_active: boolean
}

interface BriefingRecipientRow {
  user_id: string
  name: string
  role: string
  telegram_chat_id: string | null
  whatsapp_number: string | null
  is_active: boolean
  channel: string
  include_tasks: boolean
  include_invoices: boolean
  include_deals: boolean
  include_automations: boolean
}

export function BriefingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<'schedule' | 'recipients' | 'preview'>('recipients')
  const [cfg, setCfg] = React.useState<BriefingConfig | null>(null)
  const [rows, setRows] = React.useState<BriefingRecipientRow[]>([])
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sendStatus, setSendStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [previewUserId, setPreviewUserId] = React.useState<string>('')
  const [previewText, setPreviewText] = React.useState<string>('')
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [readOnly, setReadOnly] = React.useState(false)

  const { data, isLoading } = useQuery<{ config: BriefingConfig; recipients: BriefingRecipientRow[] }>({
    queryKey: ['briefing-config'],
    queryFn: async () => {
      const res = await fetch('/api/settings/morning-briefing', { credentials: 'include' })
      if (res.status === 403) { setReadOnly(true); return { config: { send_time: '08:00', active_days: [1,2,3,4,5], is_active: true }, recipients: [] } }
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })

  React.useEffect(() => {
    if (data) {
      setCfg(data.config)
      setRows(data.recipients)
      if (!previewUserId && data.recipients.length > 0) setPreviewUserId(data.recipients[0].user_id)
    }
  }, [data, previewUserId])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function save() {
    if (!cfg) return
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/settings/morning-briefing', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg, recipients: rows }),
      })
      setSaveStatus(res.ok ? 'saved' : 'error')
      if (res.ok) qc.invalidateQueries({ queryKey: ['briefing-config'] })
    } catch { setSaveStatus('error') }
  }

  async function sendNow() {
    setSendStatus('running')
    try {
      const res = await fetch('/api/agents/trigger/morning_briefing', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setSendStatus(res.ok ? 'done' : 'error')
    } catch { setSendStatus('error') }
  }

  async function loadPreview(uid: string) {
    if (!uid) return
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/settings/morning-briefing/preview?user_id=${uid}`, { credentials: 'include' })
      const d = await res.json()
      setPreviewText(d.preview ?? '')
    } catch { setPreviewText('Failed to load preview.') }
    finally { setPreviewLoading(false) }
  }

  function toggleDay(d: number) {
    setCfg((c) => c ? ({
      ...c,
      active_days: c.active_days.includes(d)
        ? c.active_days.filter((x) => x !== d)
        : [...c.active_days, d].sort(),
    }) : c)
  }

  function updateRow(userId: string, patch: Partial<BriefingRecipientRow>) {
    setRows((rs) => rs.map((r) => r.user_id === userId ? { ...r, ...patch } : r))
  }

  if (!open) return null

  const st = { fontFamily: 'var(--font-inter)' }
  const activeRows = rows.filter((r) => r.is_active)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200, backdropFilter: 'blur(3px)' }} />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 860, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 64px)',
          backgroundColor: '#fff', zIndex: 201, display: 'flex', flexDirection: 'column',
          borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p style={{ ...st, fontSize: 17, fontWeight: 700, color: '#1E293B', margin: 0 }}>Morning Briefing</p>
              <p style={{ ...st, fontSize: 12, color: '#94A3B8', margin: '3px 0 0' }}>
                {readOnly ? 'View only — only CEO/Creator can edit' : 'Configure schedule, recipients, and what each person receives'}
              </p>
            </div>
            <button onClick={onClose} style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8', borderRadius: 6, display: 'flex', marginTop: -2 }}>
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E2E8F0' }}>
            {(['recipients', 'schedule', 'preview'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); if (t === 'preview' && previewUserId && !previewText) loadPreview(previewUserId) }}
                style={{
                  ...st, padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, color: tab === t ? '#0073BB' : '#64748B',
                  borderBottom: `2px solid ${tab === t ? '#0073BB' : 'transparent'}`,
                  marginBottom: -1,
                }}
              >
                {t === 'recipients' ? `Recipients${activeRows.length > 0 ? ` (${activeRows.length})` : ''}` : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', minHeight: 0 }}>
          {isLoading ? (
            <div style={{ ...st, fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '40px 0' }}>Loading...</div>

          ) : tab === 'schedule' && cfg ? (
            <div style={{ maxWidth: 440 }}>
              {readOnly && <p style={{ ...st, fontSize: 12, color: '#E8820C', marginBottom: 16, fontWeight: 600 }}>View only — you do not have permission to edit this.</p>}

              <div style={{ marginBottom: 22 }}>
                <label style={{ ...st, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Send time</label>
                <input
                  type="time"
                  value={cfg.send_time}
                  disabled={readOnly}
                  onChange={(e) => setCfg((c) => c ? { ...c, send_time: e.target.value } : c)}
                  style={{ border: '1px solid #D5DBDB', borderRadius: 6, height: 36, padding: '0 10px', fontSize: 14, fontFamily: 'var(--font-mono)', width: 130, color: '#1E293B', opacity: readOnly ? 0.5 : 1 }}
                />
                <p style={{ ...st, fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                  24-hour format. After saving here, also update the n8n workflow trigger to match.
                </p>
              </div>

              <div style={{ marginBottom: 22 }}>
                <label style={{ ...st, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Active days</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DAYS.map((label, i) => {
                    const on = cfg.active_days.includes(i)
                    return (
                      <button
                        key={i}
                        disabled={readOnly}
                        onClick={() => toggleDay(i)}
                        style={{
                          ...st, width: 38, height: 38, borderRadius: 6,
                          border: `1px solid ${on ? '#0073BB' : '#D5DBDB'}`,
                          background: on ? '#EFF6FF' : '#fff',
                          color: on ? '#0073BB' : '#94A3B8',
                          fontSize: 11, fontWeight: 700,
                          cursor: readOnly ? 'default' : 'pointer',
                          opacity: readOnly ? 0.5 : 1,
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: readOnly ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={cfg.is_active}
                  disabled={readOnly}
                  onChange={(e) => setCfg((c) => c ? { ...c, is_active: e.target.checked } : c)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ ...st, fontSize: 13, fontWeight: 600, color: '#334155' }}>Briefing is active</span>
              </label>
              <p style={{ ...st, fontSize: 11, color: '#94A3B8', marginTop: 4, marginLeft: 26 }}>
                Uncheck to pause without deleting recipient config.
              </p>
            </div>

          ) : tab === 'recipients' ? (
            <div>
              {readOnly && <p style={{ ...st, fontSize: 12, color: '#E8820C', marginBottom: 14, fontWeight: 600 }}>View only — only CEO/Creator can edit recipient settings.</p>}
              {rows.length === 0 ? (
                <p style={{ ...st, fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '32px 0' }}>No users found.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                      {['Person', 'Active', 'Channel', 'Tasks', 'Invoices', 'Deals', 'Automations'].map((h) => (
                        <th key={h} style={{ ...st, padding: '0 10px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const hasContacts = r.telegram_chat_id || r.whatsapp_number
                      return (
                        <tr key={r.user_id} style={{ borderBottom: '1px solid #F1F5F9', opacity: r.is_active ? 1 : 0.45 }}>
                          <td style={{ padding: '11px 10px', minWidth: 140 }}>
                            <p style={{ ...st, fontSize: 13, fontWeight: 600, color: '#1E293B', margin: 0 }}>{r.name}</p>
                            <p style={{ ...st, fontSize: 11, color: '#94A3B8', margin: '2px 0 0', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{r.role}</p>
                            {!hasContacts && (
                              <p style={{ ...st, fontSize: 10, color: '#E8820C', margin: '2px 0 0', fontWeight: 600 }}>No contact set</p>
                            )}
                          </td>
                          <td style={{ padding: '11px 10px' }}>
                            <input type="checkbox" checked={r.is_active} disabled={readOnly || !hasContacts}
                              onChange={(e) => updateRow(r.user_id, { is_active: e.target.checked })}
                              style={{ width: 15, height: 15, cursor: readOnly || !hasContacts ? 'default' : 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '11px 10px' }}>
                            <select
                              value={r.channel}
                              disabled={readOnly || !r.is_active || !hasContacts}
                              onChange={(e) => updateRow(r.user_id, { channel: e.target.value })}
                              style={{ ...st, border: '1px solid #D5DBDB', borderRadius: 5, height: 28, padding: '0 6px', fontSize: 12, background: '#fff', color: '#334155', opacity: (!r.is_active || !hasContacts) ? 0.4 : 1 }}
                            >
                              {r.telegram_chat_id && <option value="telegram">Telegram</option>}
                              {r.whatsapp_number && <option value="whatsapp">WhatsApp</option>}
                              {!hasContacts && <option value="">no contact</option>}
                            </select>
                          </td>
                          {(['include_tasks', 'include_invoices', 'include_deals', 'include_automations'] as const).map((field) => (
                            <td key={field} style={{ padding: '11px 10px' }}>
                              <input type="checkbox" checked={r[field]} disabled={readOnly || !r.is_active}
                                onChange={(e) => updateRow(r.user_id, { [field]: e.target.checked })}
                                style={{ width: 15, height: 15, cursor: readOnly || !r.is_active ? 'default' : 'pointer', opacity: !r.is_active ? 0.3 : 1 }}
                              />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

          ) : tab === 'preview' ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <label style={{ ...st, fontSize: 13, fontWeight: 600, color: '#475569' }}>Preview for:</label>
                <select
                  value={previewUserId}
                  onChange={(e) => { setPreviewUserId(e.target.value); setPreviewText(''); loadPreview(e.target.value) }}
                  style={{ ...st, border: '1px solid #D5DBDB', borderRadius: 6, height: 34, padding: '0 10px', fontSize: 13, background: '#fff', color: '#1E293B' }}
                >
                  {rows.map((r) => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
                </select>
                <button
                  onClick={() => loadPreview(previewUserId)}
                  style={{ ...st, padding: '6px 14px', border: '1px solid #D5DBDB', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, color: '#334155', cursor: 'pointer' }}
                >
                  Refresh
                </button>
              </div>
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '16px 18px', minHeight: 200 }}>
                {previewLoading ? (
                  <p style={{ ...st, fontSize: 13, color: '#94A3B8' }}>Loading preview...</p>
                ) : previewText ? (
                  <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#334155', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{previewText}</pre>
                ) : (
                  <p style={{ ...st, fontSize: 13, color: '#94A3B8' }}>Select a recipient and click Refresh to see their message.</p>
                )}
              </div>
              <p style={{ ...st, fontSize: 11, color: '#94A3B8', marginTop: 8 }}>
                Live preview using today's actual data. Content changes daily.
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #E2E8F0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, background: '#FAFBFC', borderRadius: '0 0 10px 10px' }}>
          {!readOnly && (
            <button
              onClick={save}
              disabled={saveStatus === 'saving'}
              style={{ ...st, padding: '8px 18px', background: saveStatus === 'saved' ? '#1D8102' : '#0073BB', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saveStatus === 'saving' ? 0.5 : 1 }}
            >
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save Changes'}
            </button>
          )}
          {saveStatus === 'error' && <span style={{ ...st, fontSize: 12, color: '#D13212', fontWeight: 600 }}>Save failed.</span>}
          <div style={{ marginLeft: readOnly ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {sendStatus === 'done' && <span style={{ ...st, fontSize: 12, color: '#1D8102', fontWeight: 600 }}>Sent. Check Telegram.</span>}
            {sendStatus === 'error' && <span style={{ ...st, fontSize: 12, color: '#D13212', fontWeight: 600 }}>Send failed.</span>}
            <button
              onClick={sendNow}
              disabled={sendStatus === 'running'}
              style={{ ...st, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid #D5DBDB', background: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 700, color: '#334155', cursor: 'pointer', opacity: sendStatus === 'running' ? 0.5 : 1 }}
            >
              <Send size={12} />
              {sendStatus === 'running' ? 'Sending...' : 'Send Now'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
