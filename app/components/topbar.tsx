'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/app/lib/auth-client'

interface Company { id: string; name: string; invoice_prefix: string }

interface TopbarProps {
  role: string
  companies: Company[]
  name: string
}

export function Topbar({ role, companies, name }: TopbarProps) {
  const router = useRouter()
  const [selectedCompany, setSelectedCompany] = useState<string>('all')
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  useEffect(() => {
    if (role === 'cto' && companies.length > 0) {
      setSelectedCompany(companies[0].id)
    }
  }, [role, companies])

  async function handleLogout() {
    await authClient.signOut()
    router.push('/login')
  }

  return (
    <header
      className="flex items-center justify-between px-4 flex-shrink-0"
      style={{ backgroundColor: 'var(--topbar)', height: '48px', zIndex: 50 }}
    >
      <div className="flex items-center gap-4">
        <span className="font-semibold text-white text-sm" style={{ fontFamily: 'var(--font-syne), sans-serif', letterSpacing: '0.05em' }}>
          CBOP
        </span>

        {role !== 'cto' && companies.length > 0 && (
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="text-xs px-2 py-1 rounded outline-none"
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              height: '28px',
            }}
          >
            <option value="all" style={{ backgroundColor: '#232F3E' }}>All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id} style={{ backgroundColor: '#232F3E' }}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {role === 'cto' && companies.length > 0 && (
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
            {companies[0]?.name}
          </span>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="flex items-center gap-2 text-xs text-white opacity-80 hover:opacity-100 px-2 py-1 rounded"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
            style={{ backgroundColor: 'var(--blue)' }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <span>{name}</span>
        </button>

        {userMenuOpen && (
          <div
            className="absolute right-0 mt-1 w-40 rounded-md py-1"
            style={{ backgroundColor: '#fff', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, top: '100%' }}
          >
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
              style={{ color: 'var(--red)' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
