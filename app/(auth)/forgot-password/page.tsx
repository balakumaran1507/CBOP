'use client'
import { useState } from 'react'
import { authClient } from '@/app/lib/auth-client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMsg('')

    const { error: resetErr } = await authClient.signIn.magicLink({
      email,
      callbackURL: '/dashboard',
    })

    if (resetErr) {
      setError(resetErr.message || 'Failed to send link')
    } else {
      setMsg('Check your email for a reset link.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg font-sans p-4">
      <div className="w-full max-w-[420px] flex flex-col">
        
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-text1 mb-2">
            Reset Password
          </h1>
          <p className="text-text2 text-[15px] font-medium tracking-wide">
            Enter your email to receive a reset link.
          </p>
        </div>

        <div className="w-full bg-card p-8 border border-border shadow-sm rounded-none">
          {error && (
            <div className="mb-6 p-4 bg-red/10 border border-red/20 text-red text-sm font-medium flex items-center rounded-none">
              {error}
            </div>
          )}
          {msg && (
            <div className="mb-6 p-4 bg-green/10 border border-green/20 text-green text-sm font-medium flex items-center rounded-none">
              {msg}
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
                className="w-full px-4 py-3 text-[15px] text-text1 bg-bg border border-border outline-none focus:border-blue transition-colors rounded-none placeholder:text-text3 font-medium"
                placeholder="you@company.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full h-12 mt-2 flex items-center justify-center bg-text1 text-white font-bold text-[15px] transition-all hover:bg-black disabled:opacity-70 disabled:pointer-events-none rounded-none uppercase tracking-wider"
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-8 text-left">
            <a
              href="/login"
              className="text-sm font-bold text-text2 hover:text-text1 transition-colors uppercase tracking-wider"
            >
              ← Back to Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
