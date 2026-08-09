'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Guards against double-fire: if markRead(id) is already in-flight, a rapid
  // second click on the same notification must not decrement unreadCount again.
  const markingRef = useRef<Set<string>>(new Set())

  // Fetch unread count on mount + every 60s
  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/notifications/unread-count', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count)
      }
    } catch { /* ignore network errors */ }
  }

  async function openDropdown() {
    setOpen(true)
    setLoading(true)
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' })
      if (res.ok) setNotifications(await res.json())
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function markRead(id: string) {
    if (markingRef.current.has(id)) return
    markingRef.current.add(id)
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } finally {
      markingRef.current.delete(id)
    }
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' })
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  function handleNotifClick(n: Notification) {
    if (!n.read) markRead(n.id)
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  function formatTime(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  }

  const TYPE_ICONS: Record<string, string> = {
    task_assigned: '📋',
    deal_updated: '🤝',
    lead_converted: '🎯',
    invoice_sent: '📄',
    mention: '💬',
    system: '🔔',
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => open ? setOpen(false) : openDropdown()}
        style={{
          position: 'relative',
          width: 34,
          height: 34,
          borderRadius: 8,
          border: 'none',
          backgroundColor: open ? 'rgba(255,255,255,0.12)' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = open ? 'rgba(255,255,255,0.12)' : 'transparent')}
      >
        <Bell size={16} color="rgba(255,255,255,0.75)" />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            backgroundColor: '#D13212',
            borderRadius: 8,
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-inter), sans-serif',
            lineHeight: 1,
            padding: '0 3px',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 8px)',
          width: 360,
          backgroundColor: '#fff',
          border: '1px solid #D5DBDB',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #F0F0F0',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: 13, fontWeight: 600, color: '#1A2332' }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 12, color: '#0073BB', fontFamily: 'var(--font-inter)',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {loading && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8A9BA8' }}>
                Loading…
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#8A9BA8' }}>
                No notifications yet
              </div>
            )}
            {!loading && notifications.map(n => (
              <div
                key={n.id}
                onClick={() => handleNotifClick(n)}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: n.read ? '#fff' : '#F5F9FF',
                  borderBottom: '1px solid #F5F5F5',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = n.read ? '#fff' : '#F5F9FF')}
              >
                <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>
                  {TYPE_ICONS[n.type] ?? '🔔'}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    fontFamily: 'var(--font-inter)',
                    fontWeight: n.read ? 400 : 600,
                    color: '#1A2332',
                    marginBottom: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{
                      fontSize: 12, fontFamily: 'var(--font-inter)',
                      color: '#5A6A74', lineHeight: 1.4,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: '#8A9BA8', marginTop: 4,
                  }}>
                    {formatTime(n.created_at)}
                  </div>
                </div>
                {!n.read && (
                  <div style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: '#0073BB', flexShrink: 0, marginTop: 4,
                  }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
