'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/app/lib/auth-client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await authClient.signIn.email({
      email,
      password,
      callbackURL: '/dashboard',
    })

    if (authError) {
      setError(authError.message || 'Invalid email or password')
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-1" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text1)' }}>
            CBOP
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: '0.875rem' }}>Your company. One OS.</p>
        </div>

        <div className="bg-white rounded-lg p-8" style={{ border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <h2 className="text-xl font-semibold mb-6" style={{ fontFamily: 'Syne, sans-serif' }}>Sign in</h2>

          {error && (
            <div className="mb-4 px-3 py-2 rounded text-sm" style={{ backgroundColor: '#FEF2F2', color: 'var(--red)', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text1)' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 text-sm outline-none focus:ring-2"
                style={{
                  height: '36px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text1)',
                  backgroundColor: '#fff',
                  boxSizing: 'border-box',
                }}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text1)' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 text-sm outline-none focus:ring-2"
                style={{
                  height: '36px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text1)',
                  backgroundColor: '#fff',
                  boxSizing: 'border-box',
                }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full text-sm font-medium text-white"
              style={{
                height: '36px',
                borderRadius: '6px',
                backgroundColor: loading ? 'var(--text3)' : 'var(--blue)',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <a
              href="/forgot-password"
              className="text-sm"
              style={{ color: 'var(--blue)', textDecoration: 'none' }}
            >
              Forgot password?
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
