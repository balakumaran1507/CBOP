'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { NewCampaignSlideOver } from './new-campaign-slide-over'
import { CampaignDetailSlideOver } from './campaign-detail-slide-over'

interface Campaign {
  id:            string
  company_id:    string
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
}

const STATUS_COLOR_CLASS: Record<string, string> = {
  draft:     'text-text2 bg-text2/10',
  running:   'text-amber bg-amber/10',
  paused:    'text-blue bg-blue/10',
  completed: 'text-green bg-green/10',
  failed:    'text-red bg-red/10',
}

const STATUS_DOT_CLASS: Record<string, string> = {
  draft:     'bg-text2',
  running:   'bg-amber',
  paused:    'bg-blue',
  completed: 'bg-green',
  failed:    'bg-red',
}

const STATUS_LABEL: Record<string, string> = {
  draft:     'Draft',
  running:   'Sending',
  paused:    'Paused',
  completed: 'Completed',
  failed:    'Failed',
}

function ProgressBar({ sent, total, status }: { sent: number; total: number; status: string }) {
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0
  const colorClass = status === 'completed' ? 'bg-green' : status === 'failed' ? 'bg-red' : 'bg-blue'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-border/40 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-500 ease-out ${colorClass}`}
          style={{ width: `${pct}%` }} 
        />
      </div>
      <span className="text-xs font-medium text-text2 min-w-[32px] text-right">
        {pct}%
      </span>
    </div>
  )
}

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [newOpen, setNewOpen] = useState(false)
  const [detail, setDetail]   = useState<Campaign | null>(null)
  const [filter, setFilter]   = useState('all')

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['email-campaigns'],
    queryFn:  () => fetch('/api/campaigns/email').then(r => { if (!r.ok) throw new Error('api'); return r.json() }),
    refetchInterval: 4000,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/campaigns/email/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['email-campaigns'] })
      setDetail(null)
    },
  })

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter)

  const totalSent       = campaigns.reduce((a, c) => a + (c.sent_count ?? 0), 0)
  const totalRecipients = campaigns.reduce((a, c) => a + (c.valid_count ?? 0), 0)
  const activeCount     = campaigns.filter(c => c.status === 'running').length

  const stats = [
    { label: 'Total Campaigns', value: campaigns.length, accent: 'border-blue' },
    { label: 'Total Recipients', value: totalRecipients.toLocaleString(), accent: 'border-green' },
    { label: 'Emails Sent', value: totalSent.toLocaleString(), accent: 'border-blue' },
    { label: 'Active Now', value: activeCount, accent: 'border-amber' },
  ]

  const FILTER_TABS = ['all', 'draft', 'running', 'paused', 'completed']

  return (
    <div className="flex flex-col h-full bg-bg font-sans">
      <div className="px-8 pt-8 shrink-0">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-text1 m-0 tracking-tight">
              Email Campaigns
            </h1>
            <p className="text-text2 text-[15px] mt-1.5 tracking-wide">
              Bulk email with per-company sender routing, validation, and anti-spam delivery
            </p>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="bg-text1 text-white rounded-xl px-5 py-2.5 text-[15px] font-medium transition-all duration-200 hover:bg-black hover:scale-[1.02] active:scale-[0.98] shadow-sm"
          >
            + New Campaign
          </button>
        </div>

        <div className="grid grid-cols-4 gap-5 mb-8">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`bg-card border border-border/50 rounded-2xl p-6 border-l-4 ${s.accent} shadow-sm transition-all hover:shadow-md`}
            >
              <div className="text-3xl font-bold text-text1 leading-none tracking-tight">
                {s.value}
              </div>
              <div className="text-sm font-medium text-text2 mt-2">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-b border-border/50">
          {FILTER_TABS.map(f => {
            const count = f === 'all' ? campaigns.length : campaigns.filter(c => c.status === f).length
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`relative px-4 py-3 text-[14px] font-medium capitalize transition-colors duration-200 ${
                  active ? 'text-text1' : 'text-text2 hover:text-text1'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{f === 'all' ? 'All' : STATUS_LABEL[f] ?? f}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-colors ${
                    active ? 'bg-text1 text-white' : 'bg-border/40 text-text2'
                  }`}>
                    {count}
                  </span>
                </div>
                {active && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-text1 rounded-t-full" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden mx-8 mb-8 mt-6 gap-0 shadow-sm rounded-2xl border border-border/50 bg-card">
        <div className={`flex flex-col bg-card transition-all duration-300 ease-in-out ${detail ? 'w-[55%] border-r border-border/50' : 'w-full'}`}>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-b border-border/50">
                <tr>
                  {['Campaign', 'Company', 'Status', 'Progress', 'Sent / Total', 'Created', ''].map(h => (
                    <th
                      key={h}
                      className="px-5 py-4 text-xs font-semibold text-text2 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-text2">
                      Loading...
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-16 text-center text-text2 text-[15px]">
                      {filter === 'all'
                        ? 'No campaigns yet. Create one to get started.'
                        : `No ${STATUS_LABEL[filter] ?? filter} campaigns.`}
                    </td>
                  </tr>
                )}
                {filtered.map((camp) => {
                  const isSelected = detail?.id === camp.id
                  const statusColorClass = STATUS_COLOR_CLASS[camp.status] ?? 'text-text2 bg-text2/10'
                  const statusDotClass = STATUS_DOT_CLASS[camp.status] ?? 'bg-text2'
                  return (
                    <tr
                      key={camp.id}
                      onClick={() => setDetail(isSelected ? null : camp)}
                      className={`cursor-pointer transition-colors duration-150 ${
                        isSelected ? 'bg-bg' : 'hover:bg-bg/50'
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
                          <span className="font-semibold text-[15px] text-text1">{camp.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[14px] text-text2 font-medium">
                        {camp.company_name}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusColorClass}`}>
                          {STATUS_LABEL[camp.status] ?? camp.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 min-w-[140px]">
                        <ProgressBar sent={camp.sent_count} total={camp.valid_count} status={camp.status} />
                      </td>
                      <td className="px-5 py-4 text-[14px] whitespace-nowrap">
                        <span className="font-semibold text-text1">{camp.sent_count.toLocaleString()}</span>
                        <span className="text-text2 font-medium"> / {camp.valid_count.toLocaleString()}</span>
                        {camp.failed_count > 0 && (
                          <span className="text-red ml-2 text-xs font-semibold bg-red/10 px-1.5 py-0.5 rounded-md">
                            {camp.failed_count} failed
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[14px] text-text2 font-medium whitespace-nowrap">
                        {new Date(camp.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4 text-right" onClick={e => e.stopPropagation()}>
                        {camp.status === 'draft' && (
                          <button
                            onClick={() => { if (confirm('Delete this campaign?')) deleteMut.mutate(camp.id) }}
                            className="text-red hover:text-red/80 hover:bg-red/10 px-2 py-1 rounded-md text-xs font-semibold transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {detail && (
          <div className="w-[45%] flex flex-col bg-card animate-in slide-in-from-right-4 duration-300">
            <CampaignDetailSlideOver
              campaign={detail}
              onClose={() => setDetail(null)}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['email-campaigns'] })}
            />
          </div>
        )}
      </div>

      <NewCampaignSlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSaved={() => { setNewOpen(false); qc.invalidateQueries({ queryKey: ['email-campaigns'] }) }}
      />
    </div>
  )
}
