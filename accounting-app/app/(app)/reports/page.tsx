'use client'

import { useState } from 'react'
import { useCbopSession } from '../../lib/session-context'
import { TrialBalanceTab } from './trial-balance-tab'
import { ProfitAndLossTab } from './profit-and-loss-tab'
import { BalanceSheetTab } from './balance-sheet-tab'
import { GeneralLedgerTab } from './general-ledger-tab'
import { DayBookTab } from './day-book-tab'
import { AgingTab } from './aging-tab'
import { BalancesTab } from './balances-tab'
import { RollupTab } from './rollup-tab'
import { Gstr1Tab } from './gstr1-tab'
import { Gstr3bTab } from './gstr3b-tab'
import { TdsLedgerTab } from './tds-ledger-tab'
import { AuditTrailTab } from './audit-trail-tab'

// Slice 5: Reports. Every tab here hits a `requireRole('ceo')`-gated endpoint
// server-side (creator bypasses, see api/routes/accounting.ts's reportGate) -
// the sidebar already hides this link from coo/cto (ceoOnly: true in
// sidebar.tsx), but this page checks role itself too, for defense in depth,
// so a coo/cto who lands here directly (bookmark, back button, etc.) sees one
// clear message instead of a page full of 403s.
//
// Left tab rail instead of a horizontal tab bar - ten reports would overflow
// a horizontal strip, and grouping them (Financial Statements / Registers /
// Receivables & Payables / Cross-Company) reads better as a vertical rail,
// same idea as the main sidebar's grouped sections.

type ReportKey =
  | 'trial-balance'
  | 'profit-and-loss'
  | 'balance-sheet'
  | 'general-ledger'
  | 'day-book'
  | 'ar-aging'
  | 'ap-aging'
  | 'customer-balances'
  | 'vendor-balances'
  | 'rollup'
  | 'gstr1'
  | 'gstr3b'
  | 'tds-ledger'
  | 'audit-trail'

interface ReportGroup {
  label: string
  items: { key: ReportKey; label: string }[]
}

const GROUPS: ReportGroup[] = [
  {
    label: 'Financial Statements',
    items: [
      { key: 'trial-balance', label: 'Trial Balance' },
      { key: 'profit-and-loss', label: 'Profit & Loss' },
      { key: 'balance-sheet', label: 'Balance Sheet' },
    ],
  },
  {
    label: 'Registers',
    items: [
      { key: 'general-ledger', label: 'General Ledger' },
      { key: 'day-book', label: 'Day Book' },
    ],
  },
  {
    label: 'Receivables & Payables',
    items: [
      { key: 'ar-aging', label: 'AR Aging' },
      { key: 'ap-aging', label: 'AP Aging' },
      { key: 'customer-balances', label: 'Customer Balances' },
      { key: 'vendor-balances', label: 'Vendor Balances' },
    ],
  },
  {
    label: 'GST / TDS',
    items: [
      { key: 'gstr1', label: 'GSTR-1' },
      { key: 'gstr3b', label: 'GSTR-3B' },
      { key: 'tds-ledger', label: 'TDS Ledger' },
    ],
  },
  {
    label: 'Audit',
    items: [{ key: 'audit-trail', label: 'Audit Trail' }],
  },
  {
    label: 'Cross-Company',
    items: [{ key: 'rollup', label: 'Company Rollup' }],
  },
]

export default function ReportsPage() {
  const session = useCbopSession()
  const isCeo = session.role === 'ceo' || session.role === 'creator'
  const [active, setActive] = useState<ReportKey>('trial-balance')

  if (!isCeo) {
    return (
      <main className="p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6">
          <p className="font-display font-semibold text-text1">CEO / creator only</p>
          <p className="mt-2 text-sm text-text2">
            This report is only available to CEO/creator accounts. You&apos;re signed in as{' '}
            <span className="font-mono">{session.role}</span> - ask a CEO or the creator account on your CBOP
            org for access.
          </p>
        </div>
      </main>
    )
  }

  const companyId = session.activeCompanyId
  const activeCompanyName = session.companies.find((c) => c.id === companyId)?.name
  const showingRollup = active === 'rollup'

  return (
    <main className="p-6">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="font-display font-bold text-xl text-text1">Reports</h1>
          {!showingRollup && (
            <p className="text-sm text-text2 mt-0.5">{activeCompanyName ?? 'No active company selected'}</p>
          )}
          {showingRollup && <p className="text-sm text-text2 mt-0.5">All companies in scope</p>}
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <nav className="w-56 shrink-0 rounded-lg border border-border bg-card p-2">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-3 last:mb-0">
              <p className="px-2 mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-text3">{g.label}</p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={`text-left rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                      active === item.key ? 'bg-blue text-white font-medium' : 'text-text2 hover:bg-bg hover:text-text1'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {!showingRollup && !companyId ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-text2">
                No active company selected. Switch companies from the main CBOP dashboard, then come back here.
              </p>
            </div>
          ) : (
            <>
              {active === 'trial-balance' && companyId && <TrialBalanceTab companyId={companyId} />}
              {active === 'profit-and-loss' && companyId && <ProfitAndLossTab companyId={companyId} />}
              {active === 'balance-sheet' && companyId && <BalanceSheetTab companyId={companyId} />}
              {active === 'general-ledger' && companyId && <GeneralLedgerTab companyId={companyId} />}
              {active === 'day-book' && companyId && <DayBookTab companyId={companyId} />}
              {active === 'ar-aging' && companyId && <AgingTab companyId={companyId} kind="ar" />}
              {active === 'ap-aging' && companyId && <AgingTab companyId={companyId} kind="ap" />}
              {active === 'customer-balances' && companyId && <BalancesTab companyId={companyId} kind="customer" />}
              {active === 'vendor-balances' && companyId && <BalancesTab companyId={companyId} kind="vendor" />}
              {active === 'gstr1' && companyId && <Gstr1Tab companyId={companyId} />}
              {active === 'gstr3b' && companyId && <Gstr3bTab companyId={companyId} />}
              {active === 'tds-ledger' && companyId && <TdsLedgerTab companyId={companyId} />}
              {active === 'audit-trail' && companyId && <AuditTrailTab companyId={companyId} />}
              {active === 'rollup' && <RollupTab />}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
