'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Stats {
  overview: {
    totalUsers: number; activeUsers7d: number; totalMessages: number
    totalRecipes: number; totalRuns: number; totalIntegrations: number
    activeReminders: number; avgRunDurationMs: number
  }
  runsByStatus: Record<string, number>
  recipesByTrigger: Record<string, number>
  integrationsByProvider: Record<string, number>
  recentUsers: Array<{ id: string; name: string | null; telegram_username: string | null; created_at: string }>
  topRecipes: Array<{ id: string; name: string; run_count: number; trigger_type: string; enabled: boolean }>
}

interface UserRow {
  id: string; name: string | null; telegram_username: string | null; telegram_id: number
  timezone: string; wallet_address: string | null; is_admin: boolean; created_at: string
  messageCount: number; recipeCount: number; integrations: string[]
}

interface UsersData { users: UserRow[]; total: number; page: number; pages: number }

const STATUS_COLORS: Record<string, string> = {
  success: 'var(--mesh-mint)', failed: 'var(--mesh-peach)', skipped: 'var(--ink)',
  running: 'var(--mesh-cyan)', test: 'var(--mesh-yellow)',
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Schedule', email_event: 'Email', github_event: 'GitHub',
  notion_event: 'Notion', keyword: 'Keyword', manual: 'Manual',
}

const ADMIN_PASSWORD = 'harbor'

export default function AdminDashboard() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [usersData, setUsersData] = useState<UsersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'users'>('overview')
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState(false)

  // Check if already unlocked this session
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('admin_unlocked') === '1') {
      setUnlocked(true)
    }
  }, [])

  const handleUnlock = () => {
    if (password === ADMIN_PASSWORD) {
      setUnlocked(true)
      setPasswordError(false)
      sessionStorage.setItem('admin_unlocked', '1')
    } else {
      setPasswordError(true)
    }
  }

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', { credentials: 'include' })
      if (res.status === 403) { router.replace('/harbor'); return }
      if (res.ok) setStats(await res.json())
    } catch { router.replace('/harbor') } finally { setLoading(false) }
  }, [router])

  const loadUsers = useCallback(async (page = 0) => {
    const res = await fetch(`/api/admin/users?page=${page}`, { credentials: 'include' })
    if (res.ok) setUsersData(await res.json())
  }, [])

  useEffect(() => { if (unlocked) loadStats() }, [loadStats, unlocked])
  useEffect(() => { if (tab === 'users' && !usersData && unlocked) loadUsers() }, [tab, usersData, loadUsers, unlocked])

  // Password gate
  if (!unlocked) {
    return (
      <HarborShell title="Admin" showBack>
        <div className="dock-card" style={{ padding: '2rem 1.5rem', alignItems: 'center', textAlign: 'center', marginTop: '3rem' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: '1rem' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>Enter password</p>
          <form onSubmit={(e) => { e.preventDefault(); handleUnlock() }} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: '16rem' }}>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordError(false) }}
              placeholder="Password"
              autoFocus
              className="dock-input"
              style={{ textAlign: 'center' }}
            />
            {passwordError && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)' }}>Incorrect password</p>}
            <button type="submit" className="dock-btn-primary">Unlock</button>
          </form>
        </div>
      </HarborShell>
    )
  }

  if (loading) return <HarborShell title="Admin" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>
  if (!stats) return <HarborShell title="Admin" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Access denied</div></HarborShell>

  const o = stats.overview

  return (
    <HarborShell title="Admin" showBack>
      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button onClick={() => setTab('overview')} className={tab === 'overview' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1 }}>Overview</button>
        <button onClick={() => setTab('users')} className={tab === 'users' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1 }}>Users</button>
      </div>

      {/* Shipyard Inference — operator P&L, collection, settlements */}
      <a href="/admin/shipyard" className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 1.1rem', marginBottom: '1rem', textDecoration: 'none', color: 'inherit', borderColor: 'color-mix(in srgb, var(--mesh-mint) 45%, transparent)' }}>
        <span><span style={{ marginRight: '0.5rem' }}>💰</span><span style={{ fontWeight: 700 }}>Shipyard Inference</span><span className="meta-text" style={{ marginLeft: '0.5rem' }}>revenue · margin · settlements</span></span>
        <span style={{ color: 'var(--mesh-mint)' }}>→</span>
      </a>

      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
            {[
              { label: 'Total Users', value: o.totalUsers, icon: '👤' },
              { label: 'Active (7d)', value: o.activeUsers7d, icon: '🟢' },
              { label: 'Messages', value: o.totalMessages.toLocaleString(), icon: '💬' },
              { label: 'Recipes', value: o.totalRecipes, icon: '⚡' },
              { label: 'Recipe Runs', value: o.totalRuns.toLocaleString(), icon: '🔄' },
              { label: 'Integrations', value: o.totalIntegrations, icon: '🔌' },
              { label: 'Reminders', value: o.activeReminders, icon: '⏰' },
              { label: 'Avg Run Time', value: o.avgRunDurationMs > 0 ? `${(o.avgRunDurationMs / 1000).toFixed(1)}s` : '—', icon: '⏱️' },
            ].map((kpi) => (
              <div key={kpi.label} className="dock-card" style={{ alignItems: 'center', textAlign: 'center', padding: '1rem' }}>
                <span style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{kpi.icon}</span>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{kpi.value}</span>
                <span className="meta-text" style={{ marginTop: '0.25rem' }}>{kpi.label}</span>
              </div>
            ))}
          </div>

          {/* Run status breakdown */}
          <div className="dock-card">
            <p className="section-title">Run Status</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {Object.entries(stats.runsByStatus).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: STATUS_COLORS[status] ?? 'var(--ink)' }} />
                  <span style={{ fontSize: '0.85rem' }}>{status}</span>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Integrations by provider */}
          <div className="dock-card">
            <p className="section-title">Connected Integrations</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {Object.entries(stats.integrationsByProvider).map(([provider, count]) => (
                <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className="meta-text" style={{ border: '1px solid var(--ink)', borderRadius: '1rem', padding: '0.15rem 0.5rem' }}>{provider}</span>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>{count}</span>
                </div>
              ))}
              {Object.keys(stats.integrationsByProvider).length === 0 && <span style={{ opacity: 0.4, fontSize: '0.85rem' }}>None yet</span>}
            </div>
          </div>

          {/* Recipes by trigger */}
          <div className="dock-card">
            <p className="section-title">Recipes by Trigger</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {Object.entries(stats.recipesByTrigger).map(([trigger, count]) => (
                <div key={trigger} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>{TRIGGER_LABELS[trigger] ?? trigger}</span>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>{count}</span>
                </div>
              ))}
              {Object.keys(stats.recipesByTrigger).length === 0 && <span style={{ opacity: 0.4, fontSize: '0.85rem' }}>None yet</span>}
            </div>
          </div>

          {/* Top recipes */}
          <div className="dock-card">
            <p className="section-title">Top Recipes</p>
            {stats.topRecipes.length === 0 ? <span style={{ opacity: 0.4, fontSize: '0.85rem' }}>None yet</span> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {stats.topRecipes.map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: r.enabled ? 'var(--mesh-mint)' : 'var(--ink)', opacity: r.enabled ? 1 : 0.3 }} />
                      <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}>{r.name}</span>
                    </div>
                    <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>{r.run_count} runs</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent signups */}
          <div className="dock-card">
            <p className="section-title">Recent Signups</p>
            {stats.recentUsers.length === 0 ? <span style={{ opacity: 0.4, fontSize: '0.85rem' }}>None yet</span> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {stats.recentUsers.map((u) => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>{u.name ?? u.telegram_username ?? 'Unknown'}</span>
                    <span style={{ opacity: 0.4 }}>{new Date(u.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {!usersData ? (
            <div style={{ textAlign: 'center', opacity: 0.5, paddingTop: '3rem' }}>Loading users...</div>
          ) : (
            <>
              <p className="meta-text">{usersData.total} users · Page {usersData.page + 1} of {usersData.pages || 1}</p>
              {usersData.users.map((user) => (
                <div key={user.id} className="dock-card" style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem' }}>
                        {user.name ?? 'Unnamed'}
                        {user.is_admin && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', border: '1px solid var(--mesh-peach)', borderRadius: '1rem', padding: '0.1rem 0.4rem', color: 'var(--mesh-peach)' }}>Admin</span>}
                      </p>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                        {user.telegram_username ? `@${user.telegram_username}` : `ID: ${user.telegram_id}`} · {user.timezone}
                      </p>
                    </div>
                    <span style={{ fontSize: '0.7rem', opacity: 0.4 }}>{new Date(user.created_at).toLocaleDateString()}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <span><strong style={{ fontFamily: "'Outfit', sans-serif" }}>{user.messageCount}</strong> msgs</span>
                    <span><strong style={{ fontFamily: "'Outfit', sans-serif" }}>{user.recipeCount}</strong> recipes</span>
                    {user.integrations.length > 0 && (
                      <span>{user.integrations.join(', ')}</span>
                    )}
                    {user.wallet_address && (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', opacity: 0.5 }}>{user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}</span>
                    )}
                  </div>
                </div>
              ))}

              {usersData.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                  <button disabled={usersData.page === 0} onClick={() => loadUsers(usersData.page - 1)} className="dock-btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Prev</button>
                  <button disabled={usersData.page >= usersData.pages - 1} onClick={() => loadUsers(usersData.page + 1)} className="dock-btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </HarborShell>
  )
}
