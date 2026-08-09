'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MentorChatWidget } from '@/app/components/mentor-chat-widget'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string }

interface GstSummaryRow {
  company_id: string
  company_name: string
  month: string
  gst_collected: number
  total_billed: number
}

interface Filing {
  id: string
  company_id: string
  company_name: string
  filing_type: string
  period: string
  due_date: string
  status: 'pending' | 'filed' | 'overdue'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-ibm-plex-mono), monospace' }
function inr(n: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n) }
function fmtDate(d: string): string { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }

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

const STATUS_STYLE: Record<Filing['status'], { bg: string; color: string }> = {
  pending: { bg: '#F2F3F3', color: '#687078' },
  filed: { bg: '#E6F4EA', color: '#1D8102' },
  overdue: { bg: '#FDECEA', color: '#D13212' },
}

// ── Regime estimator ──────────────────────────────────────────────────────────

function RegimeEstimator() {
  const [income, setIncome] = useState('')
  const [deductions, setDeductions] = useState('')
  const [result, setResult] = useState<{ new_regime: { tax: number }; old_regime: { tax: number }; better: string; savings: number; disclaimer: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function estimate() {
    setLoading(true)
    const res = await fetch('/api/tax/estimate-regime', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ income: parseFloat(income) || 0, deductions: parseFloat(deductions) || 0 }),
    })
    setResult(await res.json())
    setLoading(false)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, padding: 18 }}>
      <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>Tax Regime Estimator</p>
      <p style={{ fontSize: 11, color: '#687078', margin: '0 0 12px' }}>Estimate only - published slab rates, not a substitute for a real filing</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={inputStyle} type="number" placeholder="Annual income (₹)" value={income} onChange={e => setIncome(e.target.value)} />
        <input style={inputStyle} type="number" placeholder="Deductions (₹, old regime)" value={deductions} onChange={e => setDeductions(e.target.value)} />
        <button onClick={estimate} disabled={loading || !income} style={{ ...btnPrimary, height: 32, fontSize: 12, whiteSpace: 'nowrap' }}>Estimate</button>
      </div>
      {result && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div style={{ padding: 10, borderRadius: 6, background: result.better === 'new' ? '#E6F4EA' : '#F2F3F3' }}>
              <p style={{ fontSize: 11, color: '#687078', margin: '0 0 2px' }}>New Regime</p>
              <p style={{ ...mono, fontSize: 16, fontWeight: 700, margin: 0, color: result.better === 'new' ? '#1D8102' : '#16191F' }}>{inr(result.new_regime.tax)}</p>
            </div>
            <div style={{ padding: 10, borderRadius: 6, background: result.better === 'old' ? '#E6F4EA' : '#F2F3F3' }}>
              <p style={{ fontSize: 11, color: '#687078', margin: '0 0 2px' }}>Old Regime</p>
              <p style={{ ...mono, fontSize: 16, fontWeight: 700, margin: 0, color: result.better === 'old' ? '#1D8102' : '#16191F' }}>{inr(result.old_regime.tax)}</p>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#16191F', margin: '0 0 4px' }}>
            <strong style={{ textTransform: 'capitalize' }}>{result.better} regime</strong> saves you {inr(result.savings)}
          </p>
          <p style={{ fontSize: 10.5, color: '#AAB5BB', margin: 0 }}>{result.disclaimer}</p>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaxPage() {
  const qc = useQueryClient()
  const [chatPersona, setChatPersona] = useState<'ca' | 'tax_saving' | 'itr_filing'>('ca')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ company_id: '', filing_type: '', period: '', due_date: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => { const res = await fetch('/api/companies', { credentials: 'include' }); return res.json() },
  })
  const companies = companiesData?.companies ?? []
  useEffect(() => { if (!form.company_id && companies.length > 0) setForm(p => ({ ...p, company_id: companies[0].id })) }, [companies, form.company_id])

  const { data: gstData } = useQuery<{ summary: GstSummaryRow[] }>({
    queryKey: ['gst-summary'],
    queryFn: async () => { const res = await fetch('/api/tax/gst-summary', { credentials: 'include' }); return res.json() },
  })
  const gstRows = gstData?.summary ?? []

  const { data: filingsData } = useQuery<{ filings: Filing[] }>({
    queryKey: ['tax-filings'],
    queryFn: async () => { const res = await fetch('/api/tax/filings', { credentials: 'include' }); return res.json() },
  })
  const filings = filingsData?.filings ?? []

  async function markFiled(id: string) {
    await fetch(`/api/tax/filings/${id}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'filed' }),
    })
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
  }

  async function addFiling() {
    if (!form.filing_type || !form.period || !form.due_date) return
    setSaving(true)
    await fetch('/api/tax/filings', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    setShowAdd(false)
    setForm(p => ({ ...p, filing_type: '', period: '', due_date: '', notes: '' }))
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
  }

  const overdueCount = filings.filter(f => f.status === 'overdue').length

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>
      <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700, fontSize: 22, color: '#16191F', margin: '0 0 4px' }}>Tax & Compliance</h1>
      <p style={{ fontSize: 13, color: '#687078', margin: '0 0 20px' }}>GST liability, filing deadlines, and tax planning across all companies</p>

      {overdueCount > 0 && (
        <div style={{ background: '#FDECEA', border: '1px solid #F5C6C0', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 12.5, color: '#D13212', fontWeight: 600 }}>
          {overdueCount} filing{overdueCount > 1 ? 's' : ''} overdue
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* GST summary */}
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0, padding: '14px 18px 4px' }}>GST Collected</p>
            <p style={{ fontSize: 11, color: '#687078', margin: '0 0 8px', padding: '0 18px' }}>From invoiced amounts - not net liability (input tax credit isn&apos;t tracked yet)</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F2F3F3' }}>
                  {['Company', 'Month', 'GST Collected', 'Total Billed'].map(h => <th key={h} style={{ padding: '8px 18px', textAlign: 'left', fontWeight: 600, color: '#687078' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {gstRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #F2F3F3' }}>
                    <td style={{ padding: '8px 18px' }}>{r.company_name}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontSize: 11.5, color: '#687078' }}>{new Date(r.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontWeight: 700, color: '#0073BB' }}>{inr(r.gst_collected)}</td>
                    <td style={{ padding: '8px 18px', ...mono }}>{inr(r.total_billed)}</td>
                  </tr>
                ))}
                {gstRows.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#AAB5BB' }}>No invoices yet</td></tr>}
              </tbody>
            </table>
          </div>

          <RegimeEstimator />

          {/* Filing deadline tracker */}
          <div style={{ background: '#fff', border: '1px solid #D5DBDB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 600, fontSize: 14, margin: 0 }}>Filing Deadlines</p>
              <button onClick={() => setShowAdd(v => !v)} style={btnGhost}>{showAdd ? 'Cancel' : '+ Add Filing'}</button>
            </div>
            {showAdd && (
              <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, width: 140 }} value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input style={{ ...inputStyle, width: 120 }} placeholder="GSTR-3B, ITR…" value={form.filing_type} onChange={e => setForm(p => ({ ...p, filing_type: e.target.value }))} />
                <input style={{ ...inputStyle, width: 110 }} placeholder="Period" value={form.period} onChange={e => setForm(p => ({ ...p, period: e.target.value }))} />
                <input style={{ ...inputStyle, width: 140 }} type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
                <button onClick={addFiling} disabled={saving} style={{ ...btnPrimary, height: 32, fontSize: 12 }}>{saving ? 'Saving…' : 'Add'}</button>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F2F3F3' }}>
                  {['Company', 'Filing', 'Period', 'Due', 'Status', ''].map(h => <th key={h} style={{ padding: '8px 18px', textAlign: 'left', fontWeight: 600, color: '#687078' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filings.map(f => (
                  <tr key={f.id} style={{ borderTop: '1px solid #F2F3F3' }}>
                    <td style={{ padding: '8px 18px' }}>{f.company_name}</td>
                    <td style={{ padding: '8px 18px', fontWeight: 600 }}>{f.filing_type}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontSize: 11.5 }}>{f.period}</td>
                    <td style={{ padding: '8px 18px', ...mono, fontSize: 11.5, color: '#687078' }}>{fmtDate(f.due_date)}</td>
                    <td style={{ padding: '8px 18px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'capitalize', ...STATUS_STYLE[f.status] }}>{f.status}</span>
                    </td>
                    <td style={{ padding: '8px 18px' }}>
                      {f.status !== 'filed' && <button onClick={() => markFiled(f.id)} style={btnGhost}>Mark filed</button>}
                    </td>
                  </tr>
                ))}
                {filings.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#AAB5BB' }}>No filings tracked yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['ca', 'tax_saving', 'itr_filing'] as const).map(p => (
              <button
                key={p}
                onClick={() => setChatPersona(p)}
                style={{
                  padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 500,
                  border: chatPersona === p ? 'none' : '1px solid #D5DBDB',
                  background: chatPersona === p ? '#0073BB' : '#fff',
                  color: chatPersona === p ? '#fff' : '#16191F', cursor: 'pointer',
                }}
              >
                {p === 'ca' ? 'CA' : p === 'tax_saving' ? 'Tax Saving' : 'ITR Filing'}
              </button>
            ))}
          </div>
          <MentorChatWidget
            key={chatPersona}
            persona={chatPersona}
            title={chatPersona === 'ca' ? 'Ask the CA' : chatPersona === 'tax_saving' ? 'Ask about Tax Saving' : 'Ask about ITR Filing'}
            height={460}
          />
        </div>
      </div>
    </div>
  )
}
