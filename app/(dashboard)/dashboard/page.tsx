'use client'
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertBar } from '@/app/components/alert-bar'
import { StatCard, StatCardSkeleton } from '@/app/components/stat-card'

// ─── types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  role: string
  statCards: {
    tasksDueToday: number
    revenueThisMonth?: number
    openDeals?: number
    cashPosition?: number | null
    teamTasksPending?: number
    activeProjects?: number
    myTasksToday?: number
  }
  alerts: { type: string; count: number; message: string }[]
  myTasks: Task[]
  todaysPriorities: Task[]
  activityFeed: Job[]
  invoiceAlerts: InvoiceAlert[]
}

interface Task {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: string
  due_date: string
  project_name: string | null
}

interface Job {
  id: string
  name: string
  type: 'automation' | 'agent'
  status: 'pending' | 'running' | 'done' | 'failed'
  completed_at: string | null
  error_message: string | null
}

interface InvoiceAlert {
  id: string
  invoice_no: string
  total: number
  due_date: string
  status: string
  client_name: string | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// pg returns NUMERIC columns as strings — accept both
function formatINR(amount: number | string): string {
  return '₹' + parseFloat(String(amount)).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// pg returns DATE columns as ISO strings (midnight UTC). Parse as local date to avoid
// timezone offset shifting the display by one day in IST before 5:30 AM.
function localDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysOverdue(dueDateStr: string): number {
  const due = localDate(dueDateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return localDate(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const PRIORITY_DOT: Record<string, string> = {
  critical: '#D13212',
  high: '#E8820C',
  medium: '#0073BB',
  low: '#AAB5BB',
}

const JOB_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  done:    { bg: '#E6F4EA', color: '#1D8102', label: 'Done' },
  failed:  { bg: '#FDECEA', color: '#D13212', label: 'Failed' },
  running: { bg: '#FFF3E0', color: '#E8820C', label: 'Running' },
  pending: { bg: '#F2F3F3', color: '#687078', label: 'Pending' },
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded" style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text1)', fontFamily: 'var(--font-syne), sans-serif' }}>
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-sm py-2" style={{ color: 'var(--text3)', fontFamily: 'var(--font-inter), sans-serif' }}>
      {text}
    </p>
  )
}

function TaskRow({ task, onMarkDone, loading }: { task: Task; onMarkDone: (id: string) => void; loading: boolean }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const overdue = localDate(task.due_date) < today
  return (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: PRIORITY_DOT[task.priority] || '#AAB5BB' }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--text1)' }}>{task.title}</p>
        {task.project_name && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text3)' }}>{task.project_name}</p>
        )}
      </div>
      <span
        className="text-xs flex-shrink-0"
        style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: overdue ? 'var(--red)' : 'var(--text2)' }}
      >
        {formatDate(task.due_date)}
      </span>
      <button
        onClick={() => onMarkDone(task.id)}
        disabled={loading}
        className="flex-shrink-0 text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity disabled:opacity-40"
        style={{ backgroundColor: '#E6F4EA', color: 'var(--green)', fontFamily: 'var(--font-inter), sans-serif' }}
      >
        Done
      </button>
    </div>
  )
}

function JobRow({ job }: { job: Job }) {
  const s = JOB_STATUS_STYLE[job.status] || JOB_STATUS_STYLE.pending
  return (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
        style={{ backgroundColor: s.bg, color: s.color, fontFamily: 'var(--font-inter), sans-serif' }}
      >
        {s.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--text1)' }}>{job.name}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{job.type}</p>
      </div>
      {job.completed_at && (
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text3)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
          {formatDate(job.completed_at)}
        </span>
      )}
    </div>
  )
}

// ─── morning briefing card ────────────────────────────────────────────────────

function MorningBriefingCard() {
  const [status, setStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle')

  async function triggerBriefing() {
    setStatus('running')
    try {
      const res = await fetch('/api/agents/trigger/morning_briefing', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <SectionCard title="Morning Briefing">
      <p className="text-sm" style={{ color: 'var(--text2)' }}>
        Daily briefing via <span style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>morning_briefing</span> agent.
        Runs automatically at 8am on weekdays.
      </p>
      <button
        onClick={triggerBriefing}
        disabled={status === 'running'}
        className="mt-3 text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: '#0073BB', color: '#fff', fontFamily: 'var(--font-inter), sans-serif' }}
      >
        {status === 'running' ? 'Triggering…' : 'Run Now'}
      </button>
      {status === 'done' && (
        <p className="text-xs mt-2" style={{ color: 'var(--green)' }}>Briefing triggered — check Telegram.</p>
      )}
      {status === 'error' && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>Failed to trigger. Check agent status.</p>
      )}
    </SectionCard>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load dashboard')
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const markDone = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/tasks/${taskId}/done`, { method: 'PATCH', credentials: 'include' })
      if (!res.ok) throw new Error('Failed to mark task done')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  if (isError) {
    return (
      <div className="p-8">
        <p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load dashboard. Check your connection.</p>
      </div>
    )
  }

  const role = data?.role
  const cards = data?.statCards
  const alerts = data?.alerts || []
  const priorities = data?.todaysPriorities || []
  const myTasks = data?.myTasks || []
  const activity = data?.activityFeed || []
  const invoiceAlerts = data?.invoiceAlerts || []

  // Build stat card array based on role
  const statCardDefs = buildStatCards(role, cards, isLoading)

  return (
    <div>
      <AlertBar alerts={alerts} />

      <div className="p-6 max-w-7xl">
        <h1 className="text-xl font-semibold mb-5" style={{ fontFamily: 'var(--font-syne), sans-serif', color: 'var(--text1)' }}>
          Home
        </h1>

        {/* Stat cards */}
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${statCardDefs.length}, 1fr)` }}>
          {statCardDefs}
        </div>

        {/* Two-column layout */}
        <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>

          {/* Left column */}
          <div className="flex flex-col gap-5">

            {/* Today's Priorities */}
            <SectionCard title="Today's Priorities">
              {isLoading ? (
                <SkeletonList rows={3} />
              ) : priorities.length === 0 ? (
                <EmptyState text="No tasks due today." />
              ) : (
                priorities.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onMarkDone={(id) => markDone.mutate(id)}
                    loading={markDone.isPending}
                  />
                ))
              )}
            </SectionCard>

            {/* My Tasks */}
            <SectionCard title="My Tasks">
              {isLoading ? (
                <SkeletonList rows={4} />
              ) : myTasks.length === 0 ? (
                <EmptyState text="No overdue or due-today tasks." />
              ) : (
                <>
                  {myTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onMarkDone={(id) => markDone.mutate(id)}
                      loading={markDone.isPending}
                    />
                  ))}
                  <p className="text-xs mt-3" style={{ color: 'var(--text3)' }}>
                    Full task management in Work → Tasks.
                  </p>
                </>
              )}
            </SectionCard>

            {/* Activity Feed */}
            <SectionCard title="Recent Activity">
              {isLoading ? (
                <SkeletonList rows={3} />
              ) : activity.length === 0 ? (
                <EmptyState text="No automation or agent activity yet." />
              ) : (
                activity.map((j) => <JobRow key={j.id} job={j} />)
              )}
            </SectionCard>

          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">

            {/* Morning Briefing */}
            <MorningBriefingCard />

            {/* Invoice Alerts */}
            <SectionCard title="Invoice Alerts">
              {isLoading ? (
                <SkeletonList rows={2} />
              ) : invoiceAlerts.length === 0 ? (
                <EmptyState text="No overdue invoices." />
              ) : (
                invoiceAlerts.map((inv) => {
                  const days = daysOverdue(inv.due_date)
                  return (
                    <div key={inv.id} className="py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className="text-xs font-medium"
                          style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--text1)' }}
                        >
                          {inv.invoice_no}
                        </p>
                        <p
                          className="text-xs font-semibold"
                          style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: 'var(--red)' }}
                        >
                          {formatINR(inv.total)}
                        </p>
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text2)' }}>
                        {inv.client_name || '—'}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--red)' }}>
                        {days} day{days !== 1 ? 's' : ''} overdue
                      </p>
                    </div>
                  )
                })
              )}
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  )
}

// ─── build stat cards array ───────────────────────────────────────────────────

function buildStatCards(
  role: string | undefined,
  cards: DashboardData['statCards'] | undefined,
  loading: boolean
): React.ReactNode[] {
  if (loading || !cards) {
    return [
      <StatCardSkeleton key="s1" />,
      <StatCardSkeleton key="s2" />,
      <StatCardSkeleton key="s3" />,
      <StatCardSkeleton key="s4" />,
    ]
  }

  if (role === 'ceo') {
    return [
      <StatCard key="rev" label="Revenue this month" value={formatINR(cards.revenueThisMonth ?? 0)} />,
      <StatCard key="deals" label="Open deals" value={cards.openDeals ?? 0} />,
      <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'var(--amber)' : undefined} />,
      <StatCard key="cash" label="Cash position" value={cards.cashPosition != null ? formatINR(cards.cashPosition) : '—'} sub="Set in CEO Panel" />,
    ]
  }

  if (role === 'coo') {
    return [
      <StatCard key="rev" label="Revenue this month" value={formatINR(cards.revenueThisMonth ?? 0)} />,
      <StatCard key="deals" label="Open deals" value={cards.openDeals ?? 0} />,
      <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'var(--amber)' : undefined} />,
      <StatCard key="team" label="Team tasks pending" value={cards.teamTasksPending ?? 0} />,
    ]
  }

  // cto — 3 cards only
  return [
    <StatCard key="proj" label="Active projects" value={cards.activeProjects ?? 0} />,
    <StatCard key="mine" label="My tasks today" value={cards.myTasksToday ?? 0} valueColor={(cards.myTasksToday ?? 0) > 0 ? 'var(--amber)' : undefined} />,
    <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'var(--amber)' : undefined} />,
  ]
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: '#E0E3E3' }} />
          <div className="h-3 rounded animate-pulse flex-1" style={{ backgroundColor: '#E0E3E3' }} />
          <div className="h-3 w-12 rounded animate-pulse flex-shrink-0" style={{ backgroundColor: '#E0E3E3' }} />
        </div>
      ))}
    </div>
  )
}
