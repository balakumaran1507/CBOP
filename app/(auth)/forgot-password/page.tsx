'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/app/lib/auth-client'

interface LockscreenStats {
  dbConnected: boolean
  dbLatencyMs?: number
  migrationsApplied: number
  activeUsers: number
  n8nStatus: string
  companiesCount: number
  openTasksCount: number
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  )
}

function ForgotPasswordForm() {
  const router = useRouter()
  
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  
  // Custom OS UX states
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [stats, setStats] = useState<LockscreenStats | null>(null)
  
  const [time, setTime] = useState({
    timeStr: '00:00:00',
    dateStr: '01.01',
    dayOfWeek: 'MONDAY',
  })

  // Clock effect
  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const month = String(now.getMonth() + 1).padStart(2, '0')
      
      const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
      const dayName = days[now.getDay()]

      setTime({
        timeStr: `${hh}:${mm}:${ss}`,
        dateStr: `${day}.${month}`,
        dayOfWeek: dayName,
      })
    }

    updateClock()
    const interval = setInterval(updateClock, 1000)
    return () => clearInterval(interval)
  }, [])

  // Auto-login / session check
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session) {
        router.replace('/dashboard')
      } else {
        setCheckingSession(false)
      }
    }).catch(() => setCheckingSession(false))
  }, [router])

  // Fetch lockscreen statistics
  useEffect(() => {
    fetch('/api/public/lockscreen-stats')
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch((err) => console.error('[stats] load failed:', err))
  }, [])

  // Drag-to-unlock and drag-to-lock states
  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('a')) {
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    setStartY(e.clientY)
    setDragOffset(0)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaY = e.clientY - startY
    if (!isUnlocked) {
      // Locked: dragging UP (negative deltaY)
      setDragOffset(Math.min(0, deltaY))
    } else {
      // Unlocked: dragging DOWN (positive deltaY)
      setDragOffset(Math.max(0, deltaY))
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)

    const threshold = 100 // Drag threshold in px
    const deltaY = e.clientY - startY

    if (!isUnlocked) {
      if (-deltaY > threshold) {
        setIsUnlocked(true)
      }
    } else {
      if (deltaY > threshold) {
        setIsUnlocked(false)
      }
    }
    setDragOffset(0)
  }

  // Keydown to unlock fallback (Spacebar)
  useEffect(() => {
    if (isUnlocked) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsUnlocked(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isUnlocked])

  const getLockscreenStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      cursor: isDragging ? 'grabbing' : 'grab',
    }
    if (!isUnlocked) {
      return {
        ...baseStyle,
        transform: `translateY(${dragOffset}px)`,
        transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }
    } else {
      return {
        ...baseStyle,
        transform: isDragging 
          ? `translateY(calc(-100% + ${dragOffset}px))` 
          : 'translateY(-100%)',
        transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMsg('')
    setLoading(true)

    const { error: authError } = await authClient.signIn.magicLink({
      email,
      callbackURL: '/dashboard',
    })

    if (authError) {
      setError(authError.message || 'Failed to send link')
    } else {
      setMsg('Check your email — click the link to sign straight in to CBOP.')
    }
    setLoading(false)
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <svg className="animate-spin h-6 w-6 text-white/50" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div 
      className="relative min-h-screen w-screen overflow-hidden bg-black font-sans select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      
      {/* 1. LOCK SCREEN LAYER */}
      <div 
        className={`absolute inset-0 z-50 bg-cover bg-center flex flex-col justify-between p-8 md:p-16 select-none ${
          isUnlocked && !isDragging ? 'pointer-events-none' : ''
        }`}
        style={{ 
          backgroundImage: `url('/CBOP-lock-screen.png')`,
          ...getLockscreenStyle()
        }}
      >
        {/* Subtle scanline and grid overlay to feel like HUD */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20 z-10" 
          style={{ 
            backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))', 
            backgroundSize: '100% 4px, 6px 100%' 
          }} 
        />
        <div className="absolute inset-0 bg-black/10 z-0" />

        {/* Lock Screen Header: Custom Sturmanskie-inspired wing SVG */}
        <div className="relative z-20 w-full flex justify-between items-start">
          <div className="flex items-center space-x-3 bg-black/20 backdrop-blur-sm p-3 border border-white/10">
            <svg className="w-10 h-10 text-white/80" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 28 C 22 28, 28 20, 32 32 C 36 20, 42 28, 52 28" strokeLinecap="round" />
              <path d="M8 32 C 20 32, 26 24, 32 36 C 38 24, 44 32, 56 32" strokeLinecap="round" opacity="0.5" />
              <path d="M16 24 C 24 24, 28 18, 32 28 C 36 18, 40 24, 48 24" strokeLinecap="round" opacity="0.7" />
              <circle cx="32" cy="30" r="6" strokeWidth="2" />
              <circle cx="32" cy="30" r="1.5" fill="currentColor" />
              <line x1="32" y1="18" x2="32" y2="24" />
              <line x1="32" y1="36" x2="32" y2="42" />
              <line x1="20" y1="30" x2="26" y2="30" />
              <line x1="38" y1="30" x2="44" y2="30" />
            </svg>
            <div className="flex flex-col text-left font-mono">
              <span className="text-white text-xs font-bold tracking-[0.25em] uppercase">CBOP // OS</span>
              <span className="text-white/40 text-[8px] tracking-[0.15em] uppercase">SYS_OPERATIONAL // V2.0</span>
            </div>
          </div>

          <div className="font-mono text-[9px] text-white/50 tracking-widest text-right bg-black/20 backdrop-blur-sm p-3 border border-white/10 space-y-1">
            <div>SYSTEM ENGINE: <span className="text-white/80 uppercase">ETHERENE CORE CLOUD</span></div>
            <div>NODE GATEWAY: <span className="text-blue-400 font-bold">AWS-AP-SOUTH-1 // SECURE</span></div>
            <div>TUNNEL LINK: <span className="text-green-400 font-bold">AES-256-GCM ENCRYPTED</span></div>
          </div>
        </div>

        {/* Lock Screen Middle Section: Main HUD Text & Date */}
        <div className="relative z-20 w-full grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
          <div className="md:col-span-2 text-left">
            <div className="text-white/40 font-mono text-xs tracking-[0.4em] uppercase mb-5">
              PASSWORD RESET PROCEDURE
            </div>
            <h1 className="text-white text-4xl md:text-6xl font-bold tracking-[0.18em] uppercase font-sans leading-[1.15] mb-4">
              CBOP.FIRST<br />
              BUSINESS SUPER OS
            </h1>
            <div className="flex items-center space-x-4">
              <span className="text-white text-2xl md:text-3xl font-mono tracking-widest font-bold">{time.dateStr}</span>
              <span className="h-px w-16 bg-white/20"></span>
              <span className="text-white/60 font-mono text-xs tracking-widest font-bold">{time.dayOfWeek}</span>
            </div>
          </div>

          <div className="hidden md:flex flex-col space-y-3.5 font-mono text-[10px] text-white/50 tracking-wider bg-black/35 backdrop-blur-md p-5 border border-white/10 rounded-none text-left z-20 w-80">
            <div className="text-white/30 text-[9px] uppercase tracking-widest pb-1 border-b border-white/10 mb-2">
              // BUSINESS OPERATIONS
            </div>
            <div>
              <span className="text-white/20">COMPANIES UNDER MGMT // </span>
              <span className="text-white/90 font-bold">{stats ? `${stats.companiesCount} ACTIVE` : 'LOADING...'}</span>
            </div>
            <div>
              <span className="text-white/20">PENDING SYSTEM TASKS // </span>
              <span className="text-white/90 font-bold">{stats ? `${stats.openTasksCount} TODO` : 'LOADING...'}</span>
            </div>
            <div>
              <span className="text-white/20">n8n_AUTOMATION_STACK // </span>
              <span className={stats?.n8nStatus === 'ONLINE' ? 'text-green-400 font-bold' : 'text-white/40'}>
                {stats ? `${stats.n8nStatus} (11 RUNNING)` : 'CHECKING...'}
              </span>
            </div>
            <div>
              <span className="text-white/20">ACTIVE CONSOLE USERS // </span>
              <span className="text-white/85">{stats ? `${stats.activeUsers} REG` : 'LOADING...'}</span>
            </div>
          </div>
        </div>

        {/* Lock Screen Bottom Section: Clock, Pulse unlock hint, and Giant semi-transparent year */}
        <div className="relative z-20 w-full flex flex-col md:flex-row justify-between items-end pt-8 md:pt-0">
          <div className="flex flex-col space-y-1 w-full md:w-auto text-center md:text-left mb-4 md:mb-0">
            <div className="text-white/40 font-mono text-[10px] tracking-[0.3em] uppercase animate-pulse">
              // PRESS SPACEBAR OR DRAG UP TO INITIATE RESET
            </div>
            <div className="text-white/20 font-mono text-[8px] tracking-[0.2em] uppercase select-none">
              SYSTEM ENGINE: <span className="text-white/45">ETHERENE DEPLOYMENT // CORE_V2.0</span>
            </div>
          </div>

          <div className="text-white font-mono font-bold tracking-widest text-right z-20">
            <span className="text-4xl md:text-6xl tracking-tighter">{time.timeStr.slice(0, 5)}</span>
            <span className="text-xl md:text-2xl text-white/40 ml-1">{time.timeStr.slice(5)}</span>
          </div>

          <div className="absolute bottom-[-60px] left-[15%] md:left-[35%] text-[24vw] font-bold text-white/[0.04] font-mono select-none pointer-events-none tracking-tighter leading-none z-0">
            26
          </div>
        </div>
      </div>

      {/* 2. BASE LAYER */}
      <div className="absolute inset-0 z-0 bg-cover bg-center filter blur-md scale-105" style={{ backgroundImage: `url('/CBOP-lock-screen.png')` }} />
      <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-[2px]" />
      
      {/* HUD overlay on base layer */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-10 z-20" 
        style={{ 
          backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))', 
          backgroundSize: '100% 4px, 6px 100%' 
        }} 
      />

      {/* Central Container */}
      <div className="relative z-30 min-h-screen flex flex-col items-center justify-center p-4">
        
        <div className="mb-10 text-center cursor-default" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center space-x-2 text-white/90 mb-3">
            <svg className="w-8 h-8" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 28 C 22 28, 28 20, 32 32 C 36 20, 42 28, 52 28" />
              <circle cx="32" cy="30" r="5" />
            </svg>
            <span className="font-sans text-2xl font-bold tracking-[0.2em] uppercase">CBOP</span>
          </div>
          <p className="text-white/55 font-mono text-[11px] tracking-[0.25em] uppercase">
            SUPER OS FOR BUSINESS ADMINISTRATION
          </p>
        </div>

        {/* FORGOT PASSWORD FORM */}
        <div className="w-full max-w-[380px] bg-white/5 backdrop-blur-xl border border-white/10 p-8 shadow-2xl relative animate-fadeIn cursor-default" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {/* Top decorative accent bar */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-white/30" />

          <div className="text-center mb-8 text-left">
            <h2 className="text-white font-bold text-lg tracking-wide uppercase font-mono">
              // RECOVER ACCESS
            </h2>
            <p className="text-white/40 font-mono text-[10px] uppercase tracking-widest mt-1">
              Enter email for secure magic link
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-955/40 border border-red-500/30 text-red-300 text-[13px] font-mono flex items-start">
              <svg className="w-4 h-4 mr-2 shrink-0 text-red-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {msg && (
            <div className="mb-6 p-4 bg-green-950/40 border border-green-500/30 text-green-300 text-[13px] font-mono flex items-start">
              <svg className="w-4 h-4 mr-2 shrink-0 text-green-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{msg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2 text-left">
              <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest font-mono">
                EMAIL ADDRESS
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                placeholder="name@company.com"
                className="w-full px-4 py-3 text-[15px] text-white bg-white/5 border border-white/10 focus:border-white/30 focus:bg-white/10 outline-none transition-all rounded-none placeholder:text-white/20 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full h-12 flex items-center justify-center bg-white text-black font-bold font-mono text-[13px] tracking-widest transition-all hover:bg-white/90 disabled:opacity-75 rounded-none uppercase active:scale-[0.98]"
            >
              <span className={loading ? 'opacity-0' : 'opacity-100'}>
                SEND SIGN-IN LINK
              </span>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 text-black" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </button>
          </form>

          <div className="mt-8 flex justify-center items-center border-t border-white/10 pt-4">
            <a
              href="/login"
              className="text-white/40 hover:text-white font-mono text-[10px] uppercase tracking-widest transition-colors flex items-center"
            >
              <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              Return to System Logon
            </a>
          </div>
        </div>

        {/* Subtle Etherene branding footer */}
        <div className="mt-12 text-center cursor-default opacity-40 hover:opacity-75 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <span className="text-white/25 font-mono text-[9px] uppercase tracking-[0.35em] select-none">
            ENGINE BY <span className="text-white/50 font-bold">ETHERENE</span>
          </span>
        </div>
      </div>
    </div>
  )
}
