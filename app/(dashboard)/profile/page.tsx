'use client'

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { ImageEditorModal } from '@/app/components/image-editor-modal'
import { getAvatarStyle } from '@/app/lib/avatar-position'

// ── Types ──────────────────────────────────────────────────────────────────────

type Role = 'creator' | 'ceo' | 'coo' | 'cto'

interface SessionData {
  userId: string
  name: string
  email: string
  role: Role
  telegramChatId: string | null
  companyIds: string[]
  companies: Array<{ id: string; name: string; invoice_prefix: string }>
  avatarUrl: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AVATAR_BG: Record<string, string> = {
  creator: '#E8820C',
  ceo:     '#0073BB',
  coo:     '#5A6A74',
  cto:     '#5A6A74',
}

const ROLE_COLOR: Record<string, string> = {
  creator: '#E8820C',
  ceo:     '#0073BB',
  coo:     '#8A9BA8',
  cto:     '#8A9BA8',
}

const ROLE_BG: Record<string, string> = {
  creator: '#FEF3E7',
  ceo:     '#E8F4FC',
  coo:     '#F0F2F4',
  cto:     '#F0F2F4',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        padding: '10px 20px',
        borderRadius: 6,
        backgroundColor: type === 'success' ? '#1D8102' : '#D13212',
        color: '#fff',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
        maxWidth: 360,
      }}
    >
      {message}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 13,
        fontWeight: 600,
        color: '#5A6A74',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        marginBottom: 16,
        borderBottom: '1px solid #F0F0F0',
        paddingBottom: 8,
      }}
    >
      {children}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #D5DBDB',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        padding: '20px 24px',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 20,
        backgroundColor: ROLE_BG[role] ?? '#F0F2F4',
        color: ROLE_COLOR[role] ?? '#5A6A74',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
      }}
    >
      {role}
    </span>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const dismissToast = () => setToast(null)

  // Profile details
  const [nameValue, setNameValue] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  // Avatar editor
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false)

  // Password
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')

  // ── Fetch session ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: SessionData) => {
        setSession(data)
        setNameValue(data.name ?? '')
      })
      .catch(() => {
        setToast({ message: 'Failed to load session data', type: 'error' })
      })
      .finally(() => setLoading(false))
  }, [])

  // ── Name save ─────────────────────────────────────────────────────────────

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setNameError('')
    if (!nameValue.trim() || nameValue.trim().length < 2) {
      setNameError('Name must be at least 2 characters')
      return
    }
    setNameSaving(true)
    try {
      const res = await fetch('/api/session/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameValue.trim() }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setNameError(body.error ?? 'Failed to update name')
        return
      }
      setSession((prev) => prev ? { ...prev, name: nameValue.trim() } : prev)
      setToast({ message: 'Display name updated', type: 'success' })
    } catch {
      setNameError('Network error — please try again')
    } finally {
      setNameSaving(false)
    }
  }

  // ── Password change ────────────────────────────────────────────────────────

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')

    if (!currentPw) { setPwError('Current password is required'); return }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters'); return }
    if (newPw !== confirmPw) { setPwError('New password and confirmation do not match'); return }

    setPwSaving(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPw,
          newPassword: newPw,
          revokeOtherSessions: false,
        }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string; message?: string }
        setPwError(body.error ?? body.message ?? 'Failed to change password')
        return
      }
      setPwSuccess('Password changed successfully')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch {
      setPwError('Network error — please try again')
    } finally {
      setPwSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          background: '#F2F3F3',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          color: '#5A6A74',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div
        style={{
          background: '#F2F3F3',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          color: '#D13212',
          fontSize: 14,
        }}
      >
        Unable to load profile. Please refresh the page.
      </div>
    )
  }

  const avatarBg = AVATAR_BG[session.role] ?? '#5A6A74'
  const initials = getInitials(session.name)
  const companyList = session.companies.map((c) => c.name).join(', ') || '—'

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 36,
    border: '1px solid #D5DBDB',
    borderRadius: 6,
    padding: '0 12px',
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 14,
    color: '#1A2332',
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const primaryBtnStyle: React.CSSProperties = {
    height: 36,
    padding: '0 20px',
    background: '#0073BB',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: nameSaving ? 0.7 : 1,
  }

  const pwBtnStyle: React.CSSProperties = {
    height: 36,
    padding: '0 20px',
    background: '#0073BB',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: pwSaving ? 0.7 : 1,
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 13,
    fontWeight: 500,
    color: '#1A2332',
    marginBottom: 6,
  }

  const fieldStyle: React.CSSProperties = {
    marginBottom: 16,
  }

  const errorStyle: React.CSSProperties = {
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 13,
    color: '#D13212',
    marginTop: 8,
  }

  const successStyle: React.CSSProperties = {
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: 13,
    color: '#1D8102',
    marginTop: 8,
  }

  return (
    <div style={{ background: '#F2F3F3', minHeight: '100vh', padding: 32 }}>
      {toast && <Toast message={toast.message} type={toast.type} onDone={dismissToast} />}

      <div style={{ maxWidth: 672, margin: '0 auto' }}>

        {/* ── Page Header ── */}
        <div style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontFamily: 'var(--font-syne), Syne, sans-serif',
              fontSize: 24,
              fontWeight: 700,
              color: '#1A2332',
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            Profile
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 14,
              color: '#5A6A74',
              margin: '6px 0 0',
            }}
          >
            Manage your personal account settings
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Identity Card ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {/* Avatar */}
              <div
                className="group"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  backgroundColor: avatarBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontWeight: 700,
                  fontSize: 20,
                  color: '#fff',
                  letterSpacing: '0.02em',
                  userSelect: 'none',
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
                onClick={() => setIsImageEditorOpen(true)}
              >
                {session.avatarUrl ? (
                  <img src={session.avatarUrl} alt={session.name} style={{ width: '100%', height: '100%', objectFit: 'cover', ...getAvatarStyle(session.email) }} />
                ) : (
                  initials
                )}
                
                {/* Hover overlay with camera icon */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                >
                  <Camera size={20} color="#fff" />
                </div>
              </div>

              <ImageEditorModal
                isOpen={isImageEditorOpen}
                onClose={() => setIsImageEditorOpen(false)}
                title="Update Profile Photo"
                aspect={1}
                onSave={async (file) => {
                  try {
                    const formData = new FormData()
                    formData.append('file', file)
                    const res = await fetch('/api/uploads/avatar', {
                      method: 'POST',
                      body: formData,
                    })
                    if (!res.ok) throw new Error('Upload failed')
                    const data = await res.json()
                    if (data.url) {
                      setSession((prev) => prev ? { ...prev, avatarUrl: data.url } : prev)
                      setToast({ message: 'Avatar updated successfully', type: 'success' })
                    }
                  } catch (err) {
                    setToast({ message: 'Failed to upload avatar', type: 'error' })
                  }
                  setIsImageEditorOpen(false)
                }}
              />

              {/* Name / Email / Role */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-inter), Inter, sans-serif',
                    fontSize: 18,
                    fontWeight: 700,
                    color: '#1A2332',
                    marginBottom: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {session.name}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-inter), Inter, sans-serif',
                    fontSize: 14,
                    color: '#5A6A74',
                    marginBottom: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {session.email}
                </div>
                <RoleBadge role={session.role} />
              </div>
            </div>

            {/* User ID */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid #F0F0F0',
                fontFamily: 'var(--font-mono), "IBM Plex Mono", monospace',
                fontSize: 12,
                color: '#8A9BA8',
              }}
            >
              ID: {session.userId}
            </div>
          </Card>

          {/* ── Edit Name ── */}
          <Card>
            <SectionTitle>Display Name</SectionTitle>
            <form onSubmit={handleNameSave} style={{ maxWidth: 400 }}>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="profile-name">
                  Full name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  style={inputStyle}
                  autoComplete="name"
                  maxLength={120}
                />
              </div>
              {nameError && <div style={errorStyle}>{nameError}</div>}
              <div style={{ marginTop: nameError ? 12 : 0 }}>
                <button type="submit" disabled={nameSaving} style={primaryBtnStyle}>
                  {nameSaving ? 'Saving…' : 'Save name'}
                </button>
              </div>
            </form>
          </Card>

          {/* ── Change Password ── */}
          <Card>
            <SectionTitle>Change Password</SectionTitle>
            <form onSubmit={handlePasswordChange} style={{ maxWidth: 400 }}>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="current-pw">
                  Current password
                </label>
                <input
                  id="current-pw"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  style={inputStyle}
                  autoComplete="current-password"
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="new-pw">
                  New password
                </label>
                <input
                  id="new-pw"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="confirm-pw">
                  Confirm new password
                </label>
                <input
                  id="confirm-pw"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                />
              </div>
              {pwError && <div style={errorStyle}>{pwError}</div>}
              {pwSuccess && <div style={successStyle}>{pwSuccess}</div>}
              <div style={{ marginTop: pwError || pwSuccess ? 12 : 0 }}>
                <button type="submit" disabled={pwSaving} style={pwBtnStyle}>
                  {pwSaving ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </Card>

          {/* ── Account Info ── */}
          <Card>
            <SectionTitle>Account</SectionTitle>
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                rowGap: 14,
                columnGap: 16,
                alignItems: 'start',
              }}
            >
              <dt
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#5A6A74',
                }}
              >
                Email
              </dt>
              <dd
                style={{
                  fontFamily: 'var(--font-mono), "IBM Plex Mono", monospace',
                  fontSize: 13,
                  color: '#1A2332',
                  margin: 0,
                  wordBreak: 'break-all',
                }}
              >
                {session.email}
              </dd>

              <dt
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#5A6A74',
                }}
              >
                Role
              </dt>
              <dd style={{ margin: 0 }}>
                <RoleBadge role={session.role} />
              </dd>

              <dt
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#5A6A74',
                }}
              >
                Companies
              </dt>
              <dd
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: 13,
                  color: '#1A2332',
                  margin: 0,
                }}
              >
                {companyList}
              </dd>

              <dt
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#5A6A74',
                }}
              >
                User ID
              </dt>
              <dd
                style={{
                  fontFamily: 'var(--font-mono), "IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: '#8A9BA8',
                  margin: 0,
                  wordBreak: 'break-all',
                }}
              >
                {session.userId}
              </dd>
            </dl>
          </Card>

        </div>
      </div>
    </div>
  )
}
