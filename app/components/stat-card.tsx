interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  valueColor?: string
}

export function StatCard({ label, value, sub, valueColor }: StatCardProps) {
  return (
    <div
      className="bg-white rounded p-5"
      style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      <p className="text-xs mb-2 uppercase tracking-wide" style={{ color: 'var(--text2)', fontFamily: 'var(--font-inter), sans-serif', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p
        className="text-2xl font-semibold"
        style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', color: valueColor || 'var(--text1)' }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: 'var(--text3)', fontFamily: 'var(--font-inter), sans-serif' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div
      className="bg-white rounded p-5"
      style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      <div className="h-3 w-24 rounded animate-pulse mb-3" style={{ backgroundColor: '#E0E3E3' }} />
      <div className="h-8 w-16 rounded animate-pulse" style={{ backgroundColor: '#E0E3E3' }} />
    </div>
  )
}
