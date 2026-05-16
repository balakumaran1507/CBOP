interface Alert {
  type: string
  count: number
  message: string
}

export function AlertBar({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null

  const primary = alerts[0]
  const remainder = alerts.length - 1

  return (
    <div
      className="flex items-center gap-3 px-6 py-2 text-sm font-medium"
      style={{ backgroundColor: 'var(--amber)', color: '#fff' }}
    >
      <span style={{ fontFamily: 'var(--font-inter), sans-serif' }}>{primary.message}</span>
      {remainder > 0 && (
        <span style={{ opacity: 0.85 }}>+{remainder} more</span>
      )}
    </div>
  )
}
