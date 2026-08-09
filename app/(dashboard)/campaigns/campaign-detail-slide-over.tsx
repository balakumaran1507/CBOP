'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface Campaign {
  id:            string
  company_name:  string
  name:          string
  subject:       string
  sender_email:  string
  reply_to:      string | null
  status:        string
  total_count:   number
  valid_count:   number
  invalid_count: number
  sent_count:    number
  failed_count:  number
  created_at:    string
  started_at:    string | null
  completed_at:  string | null
  engagement?:   { sent: number; opened: number; clicked: number }
}

interface Recipient {
  id:      string
  email:   string
  name:    string | null
  status:  string
  error:   string | null
  sent_at: string | null
}

const RECIP_STATUS_COLOR: Record<string, string> = {
  pending: 'text-text2 bg-text2/10',
  sent:    'text-green bg-green/10',
  failed:  'text-red bg-red/10',
  invalid: 'text-amber bg-amber/10',
}

const CAMP_STATUS_COLOR: Record<string, string> = {
  draft:     'text-text2 bg-text2/10',
  running:   'text-amber bg-amber/10',
  paused:    'text-blue bg-blue/10',
  completed: 'text-green bg-green/10',
  failed:    'text-red bg-red/10',
}

const CAMP_STATUS_DOT: Record<string, string> = {
  draft:     'bg-text2',
  running:   'bg-amber',
  paused:    'bg-blue',
  completed: 'bg-green',
  failed:    'bg-red',
}

const CAMP_STATUS_LABEL: Record<string, string> = {
  draft:     'Draft',
  running:   'Sending',
  paused:    'Paused',
  completed: 'Completed',
  failed:    'Failed',
}

interface Props {
  campaign:  Campaign
  onClose:   () => void
  onUpdated: () => void
}

export function CampaignDetailSlideOver({ campaign, onClose, onUpdated }: Props) {
  const qc = useQueryClient()
  const [recipientFilter, setRecipientFilter] = useState('all')
  const [startError, setStartError] = useState<string | null>(null)

  const { data: live } = useQuery<Campaign>({
    queryKey: ['email-campaign', campaign.id],
    queryFn:  () => fetch(`/api/campaigns/email/${campaign.id}`).then(r => r.json()),
    refetchInterval: campaign.status === 'running' ? 2000 : false,
    initialData: campaign,
  })

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ['email-recipients', campaign.id, recipientFilter],
    queryFn:  () => fetch(`/api/campaigns/email/${campaign.id}/recipients?status=${recipientFilter}`).then(r => r.json()),
    refetchInterval: live?.status === 'running' ? 3000 : false,
  })

  const startMut = useMutation({
    mutationFn: async () => {
      const res  = await fetch(`/api/campaigns/email/${campaign.id}/start`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data
    },
    onSuccess: () => {
      setStartError(null)
      qc.invalidateQueries({ queryKey: ['email-campaign', campaign.id] })
      onUpdated()
    },
    onError: (err: Error) => setStartError(err.message),
  })

  const pauseMut = useMutation({
    mutationFn: () => fetch(`/api/campaigns/email/${campaign.id}/pause`, { method: 'POST' }).then(r => r.json()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['email-campaign', campaign.id] }); onUpdated() },
  })

  const c = live ?? campaign
  const pct = c.valid_count > 0 ? Math.round((c.sent_count / c.valid_count) * 100) : 0
  const pending = Math.max(0, c.valid_count - c.sent_count - c.failed_count)
  
  const statusColorClass = CAMP_STATUS_COLOR[c.status] ?? 'text-text2 bg-text2/10'
  const statusDotClass = CAMP_STATUS_DOT[c.status] ?? 'bg-text2'
  const statusLabel = CAMP_STATUS_LABEL[c.status] ?? c.status

  const progressColor = c.status === 'running' ? 'bg-blue' : c.status === 'completed' ? 'bg-green' : 'bg-blue'

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="px-5 py-5 border-b border-border/50 shrink-0">
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1 min-w-0 mr-3">
            <h2 className="m-0 text-lg font-semibold text-text1 truncate tracking-tight">
              {c.name}
            </h2>
            <div className="text-sm font-medium text-text2 mt-1">
              {c.company_name} <span className="opacity-50">·</span> {c.sender_email}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full text-text2 hover:text-text1 hover:bg-bg transition-colors shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 mt-1">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${statusColorClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
            {statusLabel}
          </span>

          {(c.status === 'draft' || c.status === 'paused') && (
            <button
              onClick={() => { setStartError(null); startMut.mutate() }}
              disabled={startMut.isPending}
              className="bg-text1 text-white px-4 py-1.5 rounded-full text-xs font-semibold hover:bg-black hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {c.status === 'paused' ? 'Resume' : 'Start Sending'}
            </button>
          )}
          {c.status === 'running' && (
            <button
              onClick={() => pauseMut.mutate()}
              disabled={pauseMut.isPending}
              className="bg-amber text-white px-4 py-1.5 rounded-full text-xs font-semibold hover:bg-amber/90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              Pause
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {startError && (
          <div className="bg-red/10 border border-red/20 rounded-xl p-3 mb-5 text-sm font-medium text-red flex justify-between items-start gap-3">
            <span>{startError}</span>
            <button onClick={() => setStartError(null)} className="text-red hover:text-red/70 text-lg leading-none p-0 shrink-0">×</button>
          </div>
        )}

        <div className="bg-bg border border-border/50 rounded-2xl p-4 mb-6 shadow-sm">
          <div className="text-[11px] text-text2 font-bold uppercase tracking-wider mb-1.5">Subject</div>
          <div className="text-[15px] font-semibold text-text1">{c.subject}</div>
          {c.reply_to && (
            <div className="text-[13px] font-medium text-text2 mt-2 pt-2 border-t border-border/30">
              Reply-To: <span className="text-text1">{c.reply_to}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Valid',    value: c.valid_count,   color: 'text-green' },
            { label: 'Invalid',  value: c.invalid_count, color: 'text-red' },
            { label: 'Sent',     value: c.sent_count,    color: 'text-blue' },
            { label: 'Failed',   value: c.failed_count,  color: 'text-red' },
            { label: 'Pending',  value: pending,         color: 'text-text2' },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border/50 rounded-xl p-3 text-center shadow-sm">
              <div className={`text-xl font-bold tracking-tight ${s.color}`}>
                {s.value}
              </div>
              <div className="text-[11px] font-semibold text-text2 mt-1 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mb-8">
          <div className="flex justify-between items-center text-sm font-medium text-text2 mb-2">
            <span>Delivery Progress</span>
            <span className="text-text1 font-semibold tracking-wide">
              {pct}% <span className="text-text3 mx-1">·</span> {c.sent_count} / {c.valid_count}
            </span>
          </div>
          {c.engagement && c.engagement.sent > 0 && (
            <div className="flex gap-5 text-sm font-medium text-text2 mt-2 mb-3">
              <span>Open rate: <span className="text-green font-bold ml-1">{Math.round((c.engagement.opened / c.engagement.sent) * 100)}%</span></span>
              <span>Click rate: <span className="text-blue font-bold ml-1">{Math.round((c.engagement.clicked / c.engagement.sent) * 100)}%</span></span>
            </div>
          )}
          <div className="h-2 bg-border/40 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ease-out ${progressColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {c.status === 'running' && (
            <div className="text-[12px] text-amber mt-2 font-semibold flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber"></span>
              </span>
              Sending... {pending} remaining
              {pending > 0 && ` · est. ${Math.ceil(pending / 60)} min left`}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="text-[15px] font-semibold text-text1 mb-3">
            Recipients
          </div>
          <div className="flex gap-2 mb-4 bg-bg p-1 rounded-lg w-fit border border-border/50">
            {['all', 'pending', 'sent', 'failed'].map(f => (
              <button
                key={f}
                onClick={() => setRecipientFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-all ${
                  recipientFilter === f 
                    ? 'bg-card text-text1 shadow-sm' 
                    : 'text-text2 hover:text-text1 hover:bg-border/30'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-border/50 rounded-2xl overflow-hidden bg-card shadow-sm">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="bg-bg/50 border-b border-border/50">
                {['Email', 'Name', 'Status', 'Sent At', 'Error'].map(h => (
                  <th key={h} className="px-4 py-3 font-semibold text-text2 uppercase tracking-wider text-[11px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {recipients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center font-medium text-text2">
                    No recipients in this filter.
                  </td>
                </tr>
              )}
              {recipients.map((r) => {
                const badgeClass = RECIP_STATUS_COLOR[r.status] ?? 'text-text2 bg-text2/10'
                return (
                  <tr key={r.id} className="hover:bg-bg/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-text1">{r.email}</td>
                    <td className="px-4 py-3 font-medium text-text2">{r.name ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text2 whitespace-nowrap">
                      {r.sent_at ? new Date(r.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td className="px-4 py-3 text-red font-medium max-w-[160px] truncate">
                      {r.error ?? '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {recipients.length === 500 && (
          <div className="text-[12px] font-medium text-text2 py-4 text-center">
            Showing first 500 recipients
          </div>
        )}
      </div>
    </div>
  )
}
