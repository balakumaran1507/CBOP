'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/app/lib/auth-client'

const ALLOWED_REDIRECT_ORIGINS = [
  'https://cbop.etherence.com',
  'https://accounting.etherence.com',
]

function resolveRedirect(raw: string | null): string {
  if (!raw) return '/dashboard'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  try {
    const url = new URL(raw)
    if (ALLOWED_REDIRECT_ORIGINS.includes(url.origin)) return url.toString()
  } catch {
  }
  return '/dashboard'
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTarget = resolveRedirect(searchParams.get('redirect'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  // If already logged in, skip the login form and go straight to the destination.
  // This prevents the "Continue with CBOP → already authed → confused login loop"
  // that happens when accounting.etherence.com redirects here and the user is
  // already signed in.
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session) {
        if (redirectTarget.startsWith('http')) {
          window.location.href = redirectTarget
        } else {
          router.replace(redirectTarget)
        }
      } else {
        setCheckingSession(false)
      }
    }).catch(() => setCheckingSession(false))
  }, [redirectTarget, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await authClient.signIn.email({
      email,
      password,
      callbackURL: redirectTarget,
    })

    if (authError) {
      setError(authError.message || 'Invalid email or password')
      setLoading(false)
    } else if (redirectTarget.startsWith('http')) {
      // External redirect — loading stays true intentionally (page is leaving).
      window.location.href = redirectTarget
    } else {
      // Reset loading before the router push so if any middleware guard bounces
      // the user back to /login, the submit button is usable again immediately.
      setLoading(false)
      router.push(redirectTarget)
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <svg className="animate-spin h-6 w-6 text-text3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg font-sans p-4">
      <div className="w-full max-w-[420px] flex flex-col">
        
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-text1 mb-2">
            Sign in to CBOP
          </h1>
          <p className="text-text2 text-[15px] font-medium tracking-wide">
            Your company. One OS.
          </p>
        </div>

        <div className="w-full bg-card p-8 border border-border shadow-sm rounded-none relative">
          {error && (
            <div className="mb-6 p-4 bg-red/10 border border-red/20 text-red text-sm font-medium flex items-center rounded-none">
              <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-bold text-text1 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 text-[15px] text-text1 bg-bg border border-border outline-none focus:border-blue transition-colors rounded-none placeholder:text-text3 font-medium"
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-text1 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 text-[15px] text-text1 bg-bg border border-border outline-none focus:border-blue transition-colors rounded-none placeholder:text-text3 font-medium"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full h-12 mt-2 flex items-center justify-center bg-text1 text-white font-bold text-[15px] transition-all hover:bg-black disabled:opacity-70 disabled:pointer-events-none rounded-none uppercase tracking-wider"
            >
              <span className={`transition-opacity duration-200 ${loading ? 'opacity-0' : 'opacity-100'}`}>
                Sign In
              </span>
              
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </button>
          </form>

          <div className="mt-8 text-left">
            <a
              href="/forgot-password"
              className="text-sm font-bold text-text2 hover:text-text1 transition-colors uppercase tracking-wider"
            >
              Forgot password?
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
