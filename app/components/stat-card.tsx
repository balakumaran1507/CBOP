interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  valueColor?: string
}

export function StatCard({ label, value, sub, valueColor }: StatCardProps) {
  return (
    <div className="bg-card border border-border shadow-sm p-6 rounded-none font-sans relative hover:border-text1 transition-colors">
      <p className="text-[12px] font-bold text-text2 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`font-mono text-3xl font-bold m-0 tracking-tight ${valueColor || 'text-text1'}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[12px] mt-2 text-text3 font-medium">
          {sub}
        </p>
      )}
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="bg-card border border-border p-6 shadow-sm rounded-none">
      <div className="h-3 w-24 rounded-sm bg-bg animate-pulse mb-4" />
      <div className="h-8 w-20 rounded-sm bg-bg animate-pulse" />
    </div>
  )
}
