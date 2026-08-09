'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MentorChatWidget } from '@/app/components/mentor-chat-widget'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string }

interface LegalDoc {
  id: string
  name: string
  type: 'contract' | 'nda' | 'mou'
  company_name: string
  updated_at: string
}

interface Contract {
  id: string
  company_id: string
  company_name: string
  title: string
  counterparty: string | null
  contract_type: string
  status: 'draft' | 'sent' | 'signed' | 'active' | 'expired'
  effective_date: string | null
  expiry_date: string | null
  renewal_reminder_days: number
  notes: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }
function fmtDate(d: string | null): string { return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-' }
function daysUntil(d: string): number { return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) }

const inputStyle: React.CSSProperties = {
  border: '1px solid #D5DBDB', borderRadius: 6, height: 32, padding: '0 10px',
  fontSize: 12.5, width: '100%', background: '#fff', outline: 'none', boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  background: '#0073BB', color: '#fff', border: 'none', borderRadius: 6,
  height: 34, padding: '0 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#0073BB', border: '1px solid #D5DBDB', borderRadius: 6,
  height: 26, padding: '0 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
}

const STATUS_STYLE: Record<Contract['status'], { bg: string; color: string }> = {
  draft: { bg: '#F2F3F3', color: '#687078' },
  sent: { bg: '#FFF3E0', color: '#E8820C' },
  signed: { bg: '#EBF4FB', color: '#0073BB' },
  active: { bg: '#E6F4EA', color: '#1D8102' },
  expired: { bg: '#FDECEA', color: '#D13212' },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LegalPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ company_id: '', title: '', counterparty: '', contract_type: 'contract', effective_date: '', expiry_date: '' })
  const [saving, setSaving] = useState(false)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); return res.json() },
  })
  const companies = companiesData?.companies ?? []
  useEffect(() => { if (!form.company_id && companies.length > 0) setForm(p => ({ ...p, company_id: companies[0].id })) }, [companies, form.company_id])

  const { data: docsData } = useQuery<{ documents: LegalDoc[] }>({
    queryKey: ['legal-documents'],
    queryFn: async () => { const res = await fetch('/api/legal/documents', { credentials: 'include' }); return res.json() },
  })
  const documents = docsData?.documents ?? []

  const { data: contractsData } = useQuery<{ contracts: Contract[] }>({
    queryKey: ['legal-contracts'],
    queryFn: async () => { const res = await fetch('/api/legal/contracts', { credentials: 'include' }); return res.json() },
  })
  const contracts = contractsData?.contracts ?? []

  const expiringSoon = contracts.filter(c => c.expiry_date && c.status === 'active' && daysUntil(c.expiry_date) <= c.renewal_reminder_days && daysUntil(c.expiry_date) >= 0)

  async function updateStatus(id: string, status: Contract['status']) {
    await fetch(`/api/legal/contracts/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    qc.invalidateQueries({ queryKey: ['legal-contracts'] })
  }

  async function addContract() {
    if (!form.title) return
    setSaving(true)
    await fetch('/api/legal/contracts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    setShowAdd(false)
    setForm(p => ({ ...p, title: '', counterparty: '', effective_date: '', expiry_date: '' }))
    qc.invalidateQueries({ queryKey: ['legal-contracts'] })
  }

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>Legal</h1>
      <p style={{ fontSize: 13, color: '#687078', margin: '0 0 20px' }}>Contract repository and lifecycle tracking across all companies</p>

      {expiringSoon.length > 0 && (
        <div style={{ background: '#FFF3E0', border: '1px solid #F5D9A8', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12.5, color: '#E8820C', fontWeight: 600 }}>
          {expiringSoon.length} contract{expiringSoon.length > 1 ? 's' : ''} expiring soon: {expiringSoon.map(c => `${c.title} (${daysUntil(c.expiry_date!)}d)`).join(', ')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Contract lifecycle tracking */}
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0 }}>Contracts</p>
              <button onClick={() => setShowAdd(v => !v)} style={btnGhost}>{showAdd ? 'Cancel' : '+ Track Contract'}</button>
            </div>
            {showAdd && (
              <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, width: 130 }} value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input style={{ ...inputStyle, width: 160 }} placeholder="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
                <input style={{ ...inputStyle, width: 130 }} placeholder="Counterparty" value={form.counterparty} onChange={e => setForm(p => ({ ...p, counterparty: e.target.value }))} />
                <select style={{ ...inputStyle, width: 100 }} value={form.contract_type} onChange={e => setForm(p => ({ ...p, contract_type: e.target.value }))}>
                  <option value="contract">Contract</option>
                  <option value="nda">NDA</option>
                  <option value="mou">MOU</option>
                  <option value="other">Other</option>
                </select>
                <input style={{ ...inputStyle, width: 130 }} type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))} title="Effective date" />
                <input style={{ ...inputStyle, width: 130 }} type="date" value={form.expiry_date} onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))} title="Expiry date" />
                <button onClick={addContract} disabled={saving} style={{ ...btnPrimary, height: 32, fontSize: 12 }}>{saving ? 'Saving…' : 'Add'}</button>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F2F3F3' }}>
                  {['Title', 'Company', 'Counterparty', 'Expiry', 'Status'].map(h => <th key={h} style={{ padding: '8px 18px', textAlign: 'left', fontWeight: 600, color: '#687078' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid #F2F3F3' }}>
                    <td style={{ padding: '8px 18px', fontWeight: 600 }}>{c.title}</td>
                    <td style={{ padding: '8px 18px' }}>{c.company_name}</td>
                    <td style={{ padding: '8px 18px', color: '#687078' }}>{c.counterparty ?? '-'}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontSize: 11.5, color: c.expiry_date && daysUntil(c.expiry_date) < 30 ? '#D13212' : '#687078' }}>{fmtDate(c.expiry_date)}</td>
                    <td style={{ padding: '8px 18px' }}>
                      <select
                        value={c.status}
                        onChange={e => updateStatus(c.id, e.target.value as Contract['status'])}
                        style={{
                          fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 10, textTransform: 'capitalize',
                          border: 'none', cursor: 'pointer', ...STATUS_STYLE[c.status],
                        }}
                      >
                        {(['draft', 'sent', 'signed', 'active', 'expired'] as const).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {contracts.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#AAB5BB' }}>No contracts tracked yet</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Document repository */}
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0, padding: '14px 18px 4px' }}>Document Repository</p>
            <p style={{ fontSize: 11, color: '#687078', margin: '0 0 8px', padding: '0 18px' }}>Contract/NDA/MOU templates from Templates &amp; Document Studio</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F2F3F3' }}>
                  {['Name', 'Type', 'Company', 'Updated'].map(h => <th key={h} style={{ padding: '8px 18px', textAlign: 'left', fontWeight: 600, color: '#687078' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id} style={{ borderTop: '1px solid #F2F3F3' }}>
                    <td style={{ padding: '8px 18px', fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: '8px 18px', textTransform: 'uppercase', fontSize: 11 }}>{d.type}</td>
                    <td style={{ padding: '8px 18px' }}>{d.company_name}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontSize: 11.5, color: '#687078' }}>{fmtDate(d.updated_at)}</td>
                  </tr>
                ))}
                {documents.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#AAB5BB' }}>No contract/NDA/MOU templates yet - create one in Templates</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <MentorChatWidget persona="legal" title="Ask Legal" height={460} placeholder="Ask about contracts, compliance, IP, incorporation…" />
      </div>
    </div>
  )
}
