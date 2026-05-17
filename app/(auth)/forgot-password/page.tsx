'use client'
import { useState } from 'react'
import { authClient } from '@/app/lib/auth-client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError('')

    const { error: authError } = await authClient.signIn.magicLink({
      email,
      callbackURL: '/dashboard',
    })

    if (authError) {
      setError(authError.message || 'Failed to send magic link. Check the email address.')
      setStatus('error')
    } else {
      setStatus('sent')
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
          {status === 'sent' ? (
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-3" style={{ fontFamily: 'Syne, sans-serif' }}>Check your email</h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
                A login link was sent to <strong>{email}</strong>. Click it to sign in — it expires in 15 minutes.
              </p>
              <a
                href="/login"
                className="text-sm"
                style={{ color: 'var(--blue)', textDecoration: 'none' }}
              >
                Back to sign in
              </a>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>Forgot password</h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
                Enter your email and we&apos;ll send you a magic link to sign in.
              </p>

              {status === 'error' && (
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

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full text-sm font-medium text-white"
                  style={{
                    height: '36px',
                    borderRadius: '6px',
                    backgroundColor: status === 'loading' ? 'var(--text3)' : 'var(--blue)',
                    border: 'none',
                    cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {status === 'loading' ? 'Sending…' : 'Send magic link'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <a
                  href="/login"
                  className="text-sm"
                  style={{ color: 'var(--blue)', textDecoration: 'none' }}
                >
                  Back to sign in
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
