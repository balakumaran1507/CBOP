'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Paperclip, X, Pencil, Eye, Shield, AlertTriangle, Save } from 'lucide-react'
import DOMPurify from 'isomorphic-dompurify'
import { EmailDesignPicker } from '../email-studio/design-picker'

interface Company { id: string; name: string }

interface SpamFinding { severity: 'low' | 'medium' | 'high'; points: number; field: string; message: string }
interface SpamReport  { score: number; level: 'ok' | 'warn' | 'block'; findings: SpamFinding[] }

interface ValidationResult {
  valid_count:   number
  invalid_count: number
  total:         number
  valid:   Array<{ email: string; name: string }>
  invalid: Array<{ line: string; reason: string }>
}

interface Props {
  open:    boolean
  onClose: () => void
  onSaved: () => void
}

export function NewCampaignSlideOver({ open, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    company_id:    '',
    name:          '',
    subject:       '',
    body_html:     '',
    reply_to:      '',
    raw_list:      '',
    personal_mode: false,
  })
  const [pdfFile, setPdfFile]           = useState<File | null>(null)
  const [pdfName, setPdfName]           = useState('')
  const [validation, setValidation]     = useState<ValidationResult | null>(null)
  const [validating, setValidating]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')
  const [previewHtml, setPreviewHtml]   = useState(false)
  const [spam, setSpam]                 = useState<SpamReport | null>(null)
  const [spamChecking, setSpamChecking] = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const [emailDesignId, setEmailDesignId] = useState<string | null>(null)
  const [loadingDesign, setLoadingDesign] = useState(false)
  const [savingDesign, setSavingDesign]   = useState(false)
  const [designNotice, setDesignNotice]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn:  () => fetch('/api/session').then(r => r.json()).then(d => d.companies ?? []),
    enabled:  open,
  })

  useEffect(() => {
    if (open) {
      setForm({ company_id: '', name: '', subject: '', body_html: '', reply_to: '', raw_list: '', personal_mode: false })
      setValidation(null)
      setError('')
      setPdfFile(null)
      setPdfName('')
      setSpam(null)
      setEmailDesignId(null)
      setDesignNotice('')
    }
  }, [open])

  const loadDesign = async (id: string | null) => {
    setEmailDesignId(id)
    if (!id) return
    setLoadingDesign(true); setDesignNotice('')
    try {
      const res = await fetch(`/api/email-designs/${id}/render`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setDesignNotice(data.error || 'Failed to load design'); return }
      setForm(f => ({ ...f, subject: data.subject || f.subject, body_html: data.html }))
      setDesignNotice('Loaded - you can still edit the body below before sending.')
    } finally { setLoadingDesign(false) }
  }

  const saveAsDesign = async () => {
    if (!form.name.trim() || !form.body_html.trim()) { setDesignNotice('Name and body are required to save as a design.'); return }
    setSavingDesign(true); setDesignNotice('')
    try {
      const res = await fetch('/api/email-designs', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, subject: form.subject, html: form.body_html,
          content_mode: 'html', category: 'campaign', company_id: form.company_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setDesignNotice(data.error || 'Save failed'); return }
      setEmailDesignId(data.design.id)
      setDesignNotice('Saved to Email Studio - reusable from Documents and future campaigns.')
    } finally { setSavingDesign(false) }
  }

  const validateList = useCallback(async () => {
    if (!form.raw_list.trim()) return
    setValidating(true)
    setValidation(null)
    try {
      const res  = await fetch('/api/campaigns/email/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: form.raw_list }),
      })
      setValidation(await res.json())
    } finally { setValidating(false) }
  }, [form.raw_list])

  const checkSpam = useCallback(async () => {
    setSpamChecking(true)
    setSpam(null)
    try {
      const res = await fetch('/api/campaigns/email/spam-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: form.subject, body_html: form.body_html }),
      })
      setSpam(await res.json())
    } finally { setSpamChecking(false) }
  }, [form.subject, form.body_html])

  const handlePdf = (f: File | null | undefined) => {
    if (!f) return
    setPdfFile(f)
    setPdfName(f.name)
  }

  const save = async (startNow: boolean) => {
    setError('')
    if (!form.company_id || !form.name || !form.subject || !form.body_html || !form.raw_list) {
      setError('Company, name, subject, body, and recipient list are required.')
      return
    }
    setSaving(true)
    try {
      const res  = await fetch('/api/campaigns/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create'); return }

      if (pdfFile && data.id) {
        const fd = new FormData()
        fd.append('pdf', pdfFile)
        const pdfRes = await fetch(`/api/campaigns/email/${data.id}/attach-pdf`, { method: 'POST', body: fd })
        if (!pdfRes.ok) setError('Campaign created but PDF upload failed. Try attaching it after.')
      }

      if (startNow && data.id) {
        await fetch(`/api/campaigns/email/${data.id}/start`, { method: 'POST' })
      }
      onSaved()
    } finally { setSaving(false) }
  }

  if (!open) return null

  const selectedCompany = Array.isArray(companies) ? companies.find(c => c.id === form.company_id) : undefined
  const senderHint = selectedCompany ? `${selectedCompany.name}'s verified domain (auto-resolved)` : null
  const lineCount = form.raw_list.trim() ? form.raw_list.trim().split(/[\r\n]+/).filter(Boolean).length : 0

  return (
    <>
      <div 
        onClick={onClose} 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300"
      />

      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[780px] bg-card z-50 flex flex-col shadow-2xl animate-in slide-in-from-right-8 duration-300">
        
        <div className="px-8 py-6 border-b border-border/50 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex justify-between items-center shrink-0">
          <div>
            <h2 className="m-0 text-2xl font-bold text-text1 tracking-tight">
              New Email Campaign
            </h2>
            <p className="m-0 mt-1.5 text-[14px] text-text2 tracking-wide font-medium">
              Bulk email with per-company sender routing and anti-spam delivery
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-full border border-border/60 text-text2 hover:text-text1 hover:bg-bg transition-all active:scale-95"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
          {error && (
            <div className="bg-red/10 border border-red/20 rounded-xl p-4 text-red text-sm font-medium mb-6 animate-in fade-in flex items-start gap-3">
              <AlertTriangle className="shrink-0 mt-0.5" size={18} />
              <span>{error}</span>
            </div>
          )}

          <SectionLabel>Campaign Details</SectionLabel>

          <div className="grid grid-cols-2 gap-5 mb-5">
            <Field label="Company" required>
              <div className="relative">
                <select 
                  value={form.company_id} 
                  onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} 
                  className="w-full px-4 py-3 text-[15px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 appearance-none text-text1 font-medium"
                >
                  <option value="">Select company…</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text2">
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </div>
              </div>
              {senderHint && (
                <Hint>Sender: <span className="font-mono bg-border/30 px-1 rounded">{senderHint}</span></Hint>
              )}
            </Field>

            <Field label="Campaign Name" required>
              <input
                className="w-full px-4 py-3 text-[15px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 font-medium placeholder:text-text3 placeholder:font-normal"
                placeholder="e.g. June Outreach - Cybersecurity"
                value={form.name} 
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-5 mb-8">
            <Field label="Subject Line" required>
              <input
                className="w-full px-4 py-3 text-[15px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 font-medium placeholder:text-text3 placeholder:font-normal"
                placeholder="e.g. Secure your infrastructure"
                value={form.subject} 
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              />
            </Field>

            <Field label="Reply-To">
              <input
                className="w-full px-4 py-3 text-[15px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 font-medium placeholder:text-text3 placeholder:font-normal"
                placeholder="e.g. hello@etherence.com"
                value={form.reply_to} 
                onChange={e => setForm(f => ({ ...f, reply_to: e.target.value }))}
              />
              <Hint>Optional - defaults to sender address</Hint>
            </Field>
          </div>

          <Divider />

          <SectionLabel>Email Body</SectionLabel>

          <div className="mb-4 flex gap-3 items-start">
            <div className="flex-1">
              <EmailDesignPicker value={emailDesignId} onChange={loadDesign} companies={companies} placeholder={loadingDesign ? 'Loading…' : 'Load from Email Studio…'} />
            </div>
            <button
              onClick={saveAsDesign} disabled={savingDesign}
              className="flex items-center gap-2 bg-card text-blue border border-blue/60 rounded-xl px-4 py-3 text-[14px] font-semibold hover:bg-blue/5 transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
              title="Save the current subject + body as a reusable Email Studio design"
            >
              <Save size={16} /> {savingDesign ? 'Saving…' : 'Save as Design'}
            </button>
          </div>
          {designNotice && <p className="text-[12px] text-text2 mb-4 font-medium">{designNotice}</p>}

          <div className="mb-4">
            <div className="flex justify-between items-center mb-3">
              <div className="flex gap-2 flex-wrap items-center">
                {(['{{name}}', '{{email}}', '{{company}}']).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setForm(f => ({ ...f, body_html: f.body_html + tag }))}
                    className="bg-bg border border-border/60 rounded-md px-2.5 py-1 text-[11px] font-mono font-semibold text-text1 hover:bg-border/30 transition-colors"
                  >{tag}</button>
                ))}
                <span className="text-[11px] text-text3 font-medium ml-2">click to insert · unsubscribe footer added automatically</span>
              </div>
              <button
                onClick={() => setPreviewHtml(p => !p)}
                className={`flex items-center gap-2 border rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors shrink-0 ${
                  previewHtml ? 'bg-blue border-blue text-white hover:bg-blue/90' : 'bg-transparent border-blue text-blue hover:bg-blue/5'
                }`}
              >
                {previewHtml ? <><Pencil size={14} /> Edit</> : <><Eye size={14} /> Preview</>}
              </button>
            </div>

            {previewHtml ? (
              <div
                className="border border-border/60 rounded-xl p-6 min-h-[280px] bg-bg/50 text-[14px] leading-relaxed text-text1 shadow-inner custom-scrollbar overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.body_html) }}
              />
            ) : (
              <textarea
                className="w-full h-[280px] px-5 py-4 text-[13px] font-mono bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 placeholder:text-text3 resize-y custom-scrollbar leading-relaxed"
                placeholder={'<p>Hi {{name}},</p>\n\n<p>We\'d love to help you with...</p>\n\n<p>Best regards,<br>The Team</p>'}
                value={form.body_html}
                onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))}
              />
            )}
          </div>

          <div className="mb-8">
            <button
              onClick={checkSpam}
              disabled={spamChecking || (!form.subject && !form.body_html)}
              className="flex items-center gap-2 bg-transparent border border-border/60 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-text1 hover:bg-bg transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {spamChecking ? 'Checking…' : <><Shield size={16} /> Check spam score</>}
            </button>

            {spam && (
              <div className={`mt-4 border rounded-xl p-4 animate-in fade-in slide-in-from-top-2 ${
                spam.level === 'block' ? 'border-red/30 bg-red/5' : 
                spam.level === 'warn' ? 'border-amber/30 bg-amber/5' : 
                'border-green/30 bg-green/5'
              }`}>
                <div className={`text-[14px] font-bold ${
                  spam.level === 'block' ? 'text-red' : 
                  spam.level === 'warn' ? 'text-amber' : 
                  'text-green'
                } ${spam.findings.length ? 'mb-3' : ''}`}>
                  {spam.level === 'block' ? `Blocked - score ${spam.score} (too spammy to send)`
                    : spam.level === 'warn' ? `Warning - score ${spam.score} (will send, but delivery at risk)`
                    : `Clean - score ${spam.score} (good to go)`}
                </div>
                {spam.findings.length > 0 && (
                  <ul className="m-0 pl-5 text-[13px] text-text2 space-y-1.5 list-disc">
                    {spam.findings.map((f, i) => (
                      <li key={i}><span className="font-semibold text-text1 mr-1">[{f.field}]</span> {f.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <Divider />

          <SectionLabel>Recipients</SectionLabel>

          <div className="mb-4">
            <textarea
              className="w-full h-[200px] px-5 py-4 text-[13px] font-mono bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 placeholder:text-text3 resize-y custom-scrollbar leading-relaxed"
              placeholder={'One per line:\nplain@email.com\nJohn Doe <john@company.com>\nName,email@company.com'}
              value={form.raw_list}
              onChange={e => { setForm(f => ({ ...f, raw_list: e.target.value })); setValidation(null) }}
            />
            <div className="flex justify-between items-center mt-3">
              <span className="text-[13px] text-text2 font-mono font-medium">
                {lineCount > 0 ? `${lineCount} line${lineCount !== 1 ? 's' : ''} entered` : 'Paste emails above'}
              </span>
              <button
                onClick={validateList}
                disabled={validating || !form.raw_list.trim()}
                className="bg-text1 text-white px-5 py-2.5 rounded-xl text-[13px] font-semibold hover:bg-black hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100"
              >
                {validating ? 'Validating…' : 'Validate Emails'}
              </button>
            </div>
          </div>

          {validation && (
            <div className="mb-6 border border-border/60 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 shadow-sm">
              <div className="grid grid-cols-3 bg-bg/50 border-b border-border/60">
                <Stat label="Total"       value={validation.total} />
                <Stat label="Valid"        value={validation.valid_count}   color="text-green" />
                <Stat label="Invalid/Dup" value={validation.invalid_count} color="text-red" />
              </div>
              {validation.invalid_count > 0 && (
                <div className="p-4 max-h-[140px] overflow-y-auto border-b border-border/60 custom-scrollbar">
                  <div className="text-[11px] font-bold text-text2 uppercase tracking-wider mb-2">Invalid entries</div>
                  {validation.invalid.map((inv, i) => (
                    <div key={i} className="text-[12px] font-mono text-red py-0.5">
                      {inv.line.slice(0, 48)}{inv.line.length > 48 ? '…' : ''} <span className="text-red/60">-</span> {inv.reason}
                    </div>
                  ))}
                </div>
              )}
              {validation.valid_count > 0 && (
                <div className="p-4 bg-card">
                  <div className="text-[11px] font-bold text-text2 uppercase tracking-wider mb-2">Valid preview (first 10)</div>
                  {validation.valid.slice(0, 10).map((v, i) => (
                    <div key={i} className="text-[12px] font-mono text-green py-0.5 font-medium">
                      {v.name ? `${v.name} <${v.email}>` : v.email}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {validation && validation.valid_count > 400 && (
            <div className="bg-amber/5 border border-amber/30 rounded-xl p-4 mb-6 text-[13px] text-amber font-semibold flex items-center gap-3 animate-in fade-in">
              <AlertTriangle size={18} className="shrink-0" />
              {validation.valid_count} recipients - will take ~{Math.ceil(validation.valid_count / 60)} min and may approach the daily sending limit.
            </div>
          )}

          <Divider />

          <SectionLabel>Options</SectionLabel>

          <div className="bg-bg/50 border border-border/60 rounded-2xl p-5 mb-5 transition-all hover:bg-bg">
            <div className="flex justify-between items-start gap-4">
              <div>
                <div className="text-[15px] font-semibold text-text1 mb-1.5">Personal mode</div>
                <div className="text-[13px] text-text2 leading-relaxed font-medium">
                  Skips the unsubscribe header and footer. Use only for applicants, leads, or clients with a prior relationship. Capped at 1,000 recipients.
                </div>
              </div>
              <button
                onClick={() => setForm(f => ({ ...f, personal_mode: !f.personal_mode }))}
                className={`relative w-12 h-6 rounded-full transition-colors duration-300 shrink-0 outline-none ${
                  form.personal_mode ? 'bg-blue' : 'bg-border'
                }`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
                  form.personal_mode ? 'translate-x-6' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handlePdf(e.dataTransfer.files[0]) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer mb-8 transition-all duration-300 ${
              dragOver ? 'border-blue bg-blue/5' : 'border-border/80 bg-bg hover:bg-border/20'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => handlePdf(e.target.files?.[0])}
            />
            {pdfFile ? (
              <div className="flex items-center justify-center gap-4">
                <div className="bg-blue/10 p-3 rounded-full text-blue shrink-0">
                  <Paperclip size={24} />
                </div>
                <div className="text-left">
                  <div className="text-[15px] font-bold text-text1 truncate max-w-[200px]">{pdfName}</div>
                  <div className="text-[13px] font-medium text-text2 mt-0.5">{(pdfFile.size / 1024).toFixed(0)} KB - sent to every recipient</div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setPdfFile(null); setPdfName('') }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-red hover:bg-red/10 transition-colors ml-2 shrink-0"
                ><X size={18} /></button>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="bg-bg border border-border/60 p-3 rounded-full text-text2 mb-3">
                  <Paperclip size={22} />
                </div>
                <div className="text-[14px] font-bold text-text1">Attach PDF (optional)</div>
                <div className="text-[13px] font-medium text-text2 mt-1.5">Drag & drop or click to browse - sent to every recipient</div>
              </div>
            )}
          </div>

          <div className="bg-blue/5 border border-blue/20 rounded-2xl p-5 mb-2">
            <div className="flex items-center gap-2 text-[13px] font-bold text-blue uppercase tracking-wider mb-2">
              <Shield size={16} /> Anti-spam delivery
            </div>
            <div className="text-[13px] font-medium text-blue/80 leading-relaxed">
              Emails send at 1/second to protect sender reputation. Gmail limit: ~500/day (standard) or 2,000/day (Workspace).
              Every email includes a one-click unsubscribe link. Opted-out contacts are permanently excluded.
            </div>
          </div>

        </div>

        <div className="px-8 py-5 border-t border-border/50 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex justify-end gap-3 shrink-0 shadow-[0_-4px_20px_rgb(0,0,0,0.02)]">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-border/80 text-[14px] font-semibold text-text2 hover:bg-bg hover:text-text1 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl border border-blue text-[14px] font-bold text-blue hover:bg-blue/5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="px-7 py-2.5 rounded-xl bg-blue text-[14px] font-bold text-white hover:bg-blue/90 hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100"
          >
            {saving ? 'Starting…' : 'Save & Start Sending'}
          </button>
        </div>
      </div>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] font-bold text-text2 uppercase tracking-wider mb-4 flex items-center gap-3">
      {children}
      <div className="h-px bg-border/50 flex-1" />
    </div>
  )
}

function Divider() {
  return <div className="h-6" /> // Simplified divider logic since we use lines in SectionLabel now
}

function Field({ label, children, required }: { label: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[14px] font-semibold text-text1 pl-1">
        {label}{required && <span className="text-red ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-medium text-text3 mt-1.5 pl-1">{children}</div>
}

function Stat({ label, value, color = 'text-text1' }: { label: string; value: number; color?: string }) {
  return (
    <div className="p-4 text-center border-r border-border/60 last:border-0">
      <div className={`text-2xl font-bold font-mono tracking-tight ${color}`}>{value}</div>
      <div className="text-[11px] font-bold text-text2 uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}
