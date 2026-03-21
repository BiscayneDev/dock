'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

interface Recipe { id: string; name: string; instructions: string; trigger_type: string; trigger_config: Record<string, unknown>; enabled: boolean; run_count: number }
interface RecipeRun { id: string; status: string; triggered_at: string; output: string | null; error: string | null; duration_ms: number | null }

const STATUS_COLORS: Record<string, string> = { success: 'var(--mesh-mint)', failed: 'var(--mesh-peach)', skipped: 'var(--ink)', running: 'var(--mesh-cyan)', test: 'var(--mesh-yellow)' }

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [runs, setRuns] = useState<RecipeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rRes, runsRes] = await Promise.all([fetch(`/api/recipes/${id}`, { credentials: 'include' }), fetch(`/api/recipes/${id}/runs`, { credentials: 'include' })])
      if (rRes.ok) setRecipe((await rRes.json()).recipe)
      if (runsRes.ok) setRuns((await runsRes.json()).runs ?? [])
    } catch {} finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  const runNow = async () => { await fetch(`/api/recipes/${id}/run`, { method: 'POST', credentials: 'include' }); setTimeout(() => load(), 2000) }

  if (loading || !recipe) return <HarborShell title="Recipe" showBack backHref="/dashboard/recipes"><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>{loading ? 'Loading...' : 'Not found.'}</div></HarborShell>

  return (
    <HarborShell title={recipe.name} showBack backHref="/dashboard/recipes">
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <button onClick={runNow} className="dock-btn-secondary" style={{ flex: 1 }}>▶ Run Now</button>
        <Link href={`/dashboard/recipes/${id}/edit`} className="dock-btn-primary" style={{ flex: 1 }}>Edit</Link>
      </div>

      <div className="dock-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
          <div><span className="meta-text">Trigger</span><p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem' }}>{recipe.trigger_type}</p></div>
          <div><span className="meta-text">Status</span><p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem', color: recipe.enabled ? 'var(--mesh-mint)' : undefined }}>{recipe.enabled ? 'Active' : 'Disabled'}</p></div>
          <div><span className="meta-text">Runs</span><p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem' }}>{recipe.run_count}</p></div>
        </div>
        <span className="meta-text">Instructions</span>
        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>{recipe.instructions}</p>
      </div>

      <p className="section-title">Run History</p>
      {runs.length === 0 ? <p style={{ opacity: 0.4, fontSize: '0.85rem' }}>No runs yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {runs.map((run) => (
            <div key={run.id} className="dock-card" style={{ padding: 0 }}>
              <button onClick={() => setExpanded(expanded === run.id ? null : run.id)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontFamily: "'Lora', serif" }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_COLORS[run.status] ?? 'var(--ink)' }} />
                  <span style={{ fontSize: '0.85rem' }}>{new Date(run.triggered_at).toLocaleString()}</span>
                </div>
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{run.duration_ms ? `${(run.duration_ms/1000).toFixed(1)}s` : ''}</span>
              </button>
              {expanded === run.id && (
                <div style={{ borderTop: '1.5px solid var(--ink)', padding: '0.75rem 1rem' }}>
                  {run.output && <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', fontFamily: "'Lora', serif", opacity: 0.7 }}>{run.output}</pre>}
                  {run.error && <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', fontFamily: "'Lora', serif", color: 'var(--mesh-peach)' }}>{run.error}</pre>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </HarborShell>
  )
}
