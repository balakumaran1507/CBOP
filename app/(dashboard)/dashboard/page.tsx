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
    <div className="bg-card border border-border shadow-sm rounded-none">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="text-[13px] font-bold text-text1 uppercase tracking-wider font-sans">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-sm py-2 text-text3 font-medium">
      {text}
    </p>
  )
}

function TaskRow({ task, onMarkDone, loading }: { task: Task; onMarkDone: (id: string) => void; loading: boolean }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const overdue = localDate(task.due_date) < today
  
  let dotColor = 'bg-[#AAB5BB]'
  if (task.priority === 'critical') dotColor = 'bg-[#D13212]'
  else if (task.priority === 'high') dotColor = 'bg-[#E8820C]'
  else if (task.priority === 'medium') dotColor = 'bg-[#0073BB]'
  
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <span className={`w-2 h-2 rounded-none flex-shrink-0 ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-text1 truncate">{task.title}</p>
        {task.project_name && (
          <p className="text-[12px] font-bold text-text3 uppercase tracking-wider mt-0.5 truncate">{task.project_name}</p>
        )}
      </div>
      <span className={`text-[13px] flex-shrink-0 font-mono font-bold ${overdue ? 'text-red' : 'text-text2'}`}>
        {formatDate(task.due_date)}
      </span>
      <button
        onClick={() => onMarkDone(task.id)}
        disabled={loading}
        className="flex-shrink-0 text-[11px] font-bold uppercase tracking-wider px-2 py-1 bg-green/10 text-green rounded-none hover:bg-green hover:text-white transition-colors disabled:opacity-40"
      >
        Done
      </button>
    </div>
  )
}

function JobRow({ job }: { job: Job }) {
  const s = JOB_STATUS_STYLE[job.status] || JOB_STATUS_STYLE.pending
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <span
        className="text-[11px] px-2 py-0.5 font-bold uppercase tracking-wider rounded-none flex-shrink-0"
        style={{ backgroundColor: s.bg, color: s.color }}
      >
        {s.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-text1 truncate">{job.name}</p>
        <p className="text-[12px] font-bold text-text3 uppercase tracking-wider mt-0.5">{job.type}</p>
      </div>
      {job.completed_at && (
        <span className="text-[13px] flex-shrink-0 text-text3 font-mono font-bold">
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
      <p className="text-[13px] font-medium text-text2">
        Daily briefing via <span className="font-mono bg-bg px-1 rounded-sm">morning_briefing</span> agent.
        Runs automatically at 8am on weekdays.
      </p>
      <button
        onClick={triggerBriefing}
        disabled={status === 'running'}
        className="mt-4 text-[12px] font-bold uppercase tracking-wider px-4 py-2 bg-blue text-white rounded-none transition-colors hover:bg-black disabled:opacity-40"
      >
        {status === 'running' ? 'Triggering…' : 'Run Now'}
      </button>
      {status === 'done' && (
        <p className="text-[13px] font-bold text-green mt-3">Briefing triggered — check Telegram.</p>
      )}
      {status === 'error' && (
        <p className="text-[13px] font-bold text-red mt-3">Failed to trigger. Check agent status.</p>
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
        <p className="text-sm font-bold text-red">Failed to load dashboard. Check your connection.</p>
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
    <div className="min-h-full font-sans text-text1">
      <AlertBar alerts={alerts} />

      <div className="p-6 max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-6">
          Home
        </h1>

        {/* Stat cards */}
        <div 
          className="grid gap-4 mb-6" 
          style={{ gridTemplateColumns: `repeat(${statCardDefs.length}, 1fr)` }}
        >
          {statCardDefs}
        </div>

        {/* Two-column layout */}
        <div className="grid gap-5 md:grid-cols-[2fr_1fr]">

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
                  <p className="text-[12px] font-bold text-text3 uppercase tracking-wider mt-4">
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
                    <div key={inv.id} className="py-3 border-b border-border last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-bold text-text1 font-mono">
                          {inv.invoice_no}
                        </p>
                        <p className="text-[13px] font-bold text-red font-mono">
                          {formatINR(inv.total)}
                        </p>
                      </div>
                      <p className="text-[12px] font-bold text-text2 uppercase tracking-wider mt-1 truncate">
                        {inv.client_name || '—'}
                      </p>
                      <p className="text-[12px] font-bold text-red uppercase tracking-wider mt-0.5">
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

  if (role === 'ceo' || role === 'creator') {
    return [
      <StatCard key="rev" label="Revenue this month" value={formatINR(cards.revenueThisMonth ?? 0)} />,
      <StatCard key="deals" label="Open deals" value={cards.openDeals ?? 0} />,
      <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'text-amber' : undefined} />,
      <StatCard key="cash" label="Cash position" value={cards.cashPosition != null ? formatINR(cards.cashPosition) : '—'} sub="Set in CEO Panel" />,
    ]
  }

  if (role === 'coo') {
    return [
      <StatCard key="rev" label="Revenue this month" value={formatINR(cards.revenueThisMonth ?? 0)} />,
      <StatCard key="deals" label="Open deals" value={cards.openDeals ?? 0} />,
      <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'text-amber' : undefined} />,
      <StatCard key="team" label="Team tasks pending" value={cards.teamTasksPending ?? 0} />,
    ]
  }

  // cto — 3 cards only
  return [
    <StatCard key="proj" label="Active projects" value={cards.activeProjects ?? 0} />,
    <StatCard key="mine" label="My tasks today" value={cards.myTasksToday ?? 0} valueColor={(cards.myTasksToday ?? 0) > 0 ? 'text-amber' : undefined} />,
    <StatCard key="tasks" label="Tasks due today" value={cards.tasksDueToday} valueColor={cards.tasksDueToday > 0 ? 'text-amber' : undefined} />,
  ]
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-none animate-pulse bg-bg flex-shrink-0" />
          <div className="h-3 rounded-none animate-pulse bg-bg flex-1" />
          <div className="h-3 w-12 rounded-none animate-pulse bg-bg flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

