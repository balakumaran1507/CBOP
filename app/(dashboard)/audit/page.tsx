'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Send, ShieldCheck, Zap } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FindingStatus = 'open' | 'dismissed' | 'resolved'
type FindingType = 'duplicate_expense' | 'category_spike' | 'overdue_invoice' | 'negative_margin'

interface Finding {
  id:            string
  company_id:    string
  company_name:  string
  type:          FindingType
  severity:      'warning' | 'critical'
  status:        FindingStatus
  detail:        string
  detected_at:   string
  resolved_at:   string | null
}

interface TrendPoint {
  day:   string
  count: number
}

interface MentorMessage {
  role:    'user' | 'assistant'
  content: string
  ts:      string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<FindingType, string> = {
  duplicate_expense: 'Duplicate Expense',
  category_spike:    'Category Spike',
  overdue_invoice:   'Overdue Invoice',
  negative_margin:   'Negative Margin',
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function FindingsTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) {
    return <div className="h-[80px] flex items-center justify-center text-text3 text-[12px] font-medium">Not enough history yet</div>
  }
  const W = 700, H = 80
  const pad = { l: 4, r: 4, t: 6, b: 16 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b
  const max = Math.max(...data.map(d => d.count), 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[80px] overflow-visible">
      {data.map((d, i) => {
        const barW = cw / data.length - 3
        const x = pad.l + (i / data.length) * cw
        const barH = (d.count / max) * ch
        return (
          <rect 
            key={d.day} 
            x={x} 
            y={pad.t + ch - barH} 
            width={barW} 
            height={barH} 
            className="fill-amber/80 transition-all duration-300 hover:fill-amber" 
            rx={4} 
          />
        )
      })}
    </svg>
  )
}

// ── Embedded Auditor chat ────────────────────────────────────────────────────

function AuditorChat() {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, refetch } = useQuery<{ messages: MentorMessage[] }>({
    queryKey: ['mentor-history', 'auditor'],
    queryFn: async () => {
      const res = await fetch('/api/mentor/history/auditor', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const messages = data?.messages ?? []

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!input.trim() || sending) return
    setSending(true)
    setInput('')
    await fetch('/api/mentor/chat', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'auditor', message: input.trim() }),
    })
    setSending(false)
    refetch()
  }

  return (
    <div className="bg-card border border-border/60 rounded-3xl flex flex-col h-[600px] shadow-sm overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-border/40 bg-bg/50">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded bg-blue/10 flex items-center justify-center">
            <Zap size={14} className="text-blue" />
          </div>
          <span className="font-bold text-[15px] text-text1">Ask the Auditor</span>
        </div>
        <p className="text-[12px] text-text2 m-0 font-medium ml-8">Grounded in the findings on this page - ask it to explain or prioritize anything</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 custom-scrollbar">
        {isLoading && (
          <div className="flex justify-center mt-4">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-border animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-border animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-border animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        
        {!isLoading && messages.length === 0 && (
          <div className="text-text3 text-[13px] text-center mt-10 font-medium">Ask about any finding below</div>
        )}
        
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
            <div className={`
              max-w-[85%] px-4 py-3 text-[13px] leading-relaxed shadow-sm
              ${m.role === 'user' 
                ? 'bg-blue text-white rounded-[20px] rounded-tr-[4px]' 
                : 'bg-bg border border-border/60 text-text1 rounded-[20px] rounded-tl-[4px]'}
            `}>
              {m.content}
            </div>
          </div>
        ))}
        
        {sending && (
          <div className="flex justify-start animate-in fade-in">
            <div className="max-w-[85%] px-4 py-3 bg-bg border border-border/60 rounded-[20px] rounded-tl-[4px] shadow-sm flex gap-1 items-center h-[42px]">
              <div className="w-1.5 h-1.5 rounded-full bg-text3 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-text3 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-text3 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      
      <div className="p-4 bg-bg/30 border-t border-border/40">
        <div className="relative flex items-center">
          <input
            className="w-full h-11 pl-4 pr-12 text-[13px] bg-bg border border-border/60 rounded-2xl outline-none transition-all focus:border-blue focus:ring-4 focus:ring-blue/10 text-text1 placeholder:text-text3"
            placeholder="e.g. which of these should I look at first?"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          <button 
            onClick={send} 
            disabled={sending || !input.trim()} 
            className="absolute right-1.5 w-8 h-8 rounded-xl flex items-center justify-center bg-blue text-white hover:bg-blue/90 disabled:opacity-50 disabled:bg-border transition-colors"
          >
            <Send size={14} className="ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | FindingStatus>('open')

  const { data: findingsData, isLoading } = useQuery<{ findings: Finding[] }>({
    queryKey: ['audit-findings', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : ''
      const res = await fetch(`/api/audit/findings${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const findings = findingsData?.findings ?? []

  const { data: trendData } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ['audit-trend'],
    queryFn: async () => {
      const res = await fetch('/api/audit/findings/trend', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const scanMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/audit/scan', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ scanned: number; inserted: number; checked_at: string }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-findings'] })
      qc.invalidateQueries({ queryKey: ['audit-trend'] })
    },
  })

  async function updateStatus(id: string, status: FindingStatus) {
    await fetch(`/api/audit/findings/${id}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    qc.invalidateQueries({ queryKey: ['audit-findings'] })
  }

  const openCount = findings.filter(f => f.status === 'open').length
  const criticalOpen = findings.filter(f => f.status === 'open' && f.severity === 'critical').length

  return (
    <div className="p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500 font-sans">
      <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-bold text-3xl text-text1 m-0 mb-1.5 tracking-tight flex items-center gap-3">
            Audit
          </h1>
          <p className="text-[14px] text-text2 m-0 font-medium tracking-wide">
            Deterministic checks against real transaction data - not a chatbot guessing at numbers
          </p>
        </div>
        <button 
          onClick={() => scanMut.mutate()} 
          disabled={scanMut.isPending} 
          className="flex items-center gap-2 bg-text1 text-white rounded-xl px-5 py-2.5 text-[14px] font-bold hover:bg-black transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:pointer-events-none"
        >
          <RefreshCw size={16} className={scanMut.isPending ? 'animate-spin' : ''} /> {scanMut.isPending ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>

      {scanMut.data && (
        <div className="bg-green/10 border border-green/20 rounded-xl p-4 mb-6 text-[13px] text-green font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <ShieldCheck size={18} />
          Scan complete - {scanMut.data.scanned} checks run, {scanMut.data.inserted} new finding{scanMut.data.inserted === 1 ? '' : 's'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-[0_2px_10px_rgb(0,0,0,0.02)]">
          <p className="text-[11px] font-bold text-text2 uppercase tracking-wider m-0 mb-2">Open Findings</p>
          <p className={`font-mono text-3xl font-bold m-0 tracking-tight ${openCount > 0 ? 'text-amber' : 'text-green'}`}>{openCount}</p>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-[0_2px_10px_rgb(0,0,0,0.02)]">
          <p className="text-[11px] font-bold text-text2 uppercase tracking-wider m-0 mb-2">Critical</p>
          <p className={`font-mono text-3xl font-bold m-0 tracking-tight ${criticalOpen > 0 ? 'text-red' : 'text-green'}`}>{criticalOpen}</p>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-[0_2px_10px_rgb(0,0,0,0.02)] flex flex-col justify-between">
          <p className="text-[11px] font-bold text-text2 uppercase tracking-wider m-0 mb-4">Findings, last 30 days</p>
          <FindingsTrendChart data={trendData?.trend ?? []} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 p-1 bg-border/20 rounded-2xl w-max border border-border/40">
            {(['open', 'dismissed', 'resolved', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`
                  px-5 py-2 rounded-xl text-[13px] font-bold capitalize transition-all duration-200
                  ${statusFilter === s 
                    ? 'bg-card text-text1 shadow-sm' 
                    : 'text-text2 hover:text-text1 hover:bg-border/30'}
                `}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border/50 rounded-3xl overflow-hidden shadow-sm">
            {isLoading ? (
              <div className="p-12 text-center text-text3 font-medium text-[14px]">Loading findings…</div>
            ) : findings.length === 0 ? (
              <div className="p-16 text-center text-text3 flex flex-col items-center">
                <CheckCircle2 size={40} className="opacity-20 mb-4" />
                <p className="text-[14px] font-medium m-0">No {statusFilter !== 'all' ? statusFilter : ''} findings. Run a scan to check for issues.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {findings.map(f => (
                  <div key={f.id} className="p-5 flex gap-4 items-start hover:bg-bg/50 transition-colors group">
                    <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${f.severity === 'critical' ? 'bg-red/10' : 'bg-amber/10'}`}>
                      {f.severity === 'critical'
                        ? <ShieldAlert size={16} className="text-red" />
                        : <AlertTriangle size={16} className="text-amber" />}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="text-[11px] font-bold uppercase text-text2 tracking-wider">{TYPE_LABELS[f.type]}</span>
                        <div className="w-1 h-1 rounded-full bg-border" />
                        <span className="font-mono text-[11px] font-medium text-text3">{fmtDateTime(f.detected_at)}</span>
                      </div>
                      <p className="text-[14px] text-text1 m-0 leading-relaxed font-medium">{f.detail}</p>
                    </div>
                    
                    <div className="flex-shrink-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      {f.status === 'open' && (
                        <>
                          <button 
                            onClick={() => updateStatus(f.id, 'resolved')} 
                            className="px-3 py-1.5 rounded-lg border border-green/30 text-green hover:bg-green/10 text-[12px] font-bold transition-colors"
                          >
                            Resolve
                          </button>
                          <button 
                            onClick={() => updateStatus(f.id, 'dismissed')} 
                            className="px-3 py-1.5 rounded-lg border border-border/60 text-text2 hover:bg-bg hover:text-text1 text-[12px] font-bold transition-colors"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                      {f.status !== 'open' && (
                        <button 
                          onClick={() => updateStatus(f.id, 'open')} 
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-text2 hover:bg-bg hover:text-text1 text-[12px] font-bold transition-colors"
                        >
                          {f.status === 'resolved' ? <CheckCircle2 size={12} /> : <XCircle size={12} />} Reopen
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <AuditorChat />
      </div>
    </div>
  )
}
