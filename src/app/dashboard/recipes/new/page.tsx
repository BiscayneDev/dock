'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

type TriggerType = 'schedule' | 'email_event' | 'github_event' | 'notion_event' | 'keyword' | 'manual'
interface RecipeForm { triggerType: TriggerType | null; triggerConfig: Record<string, unknown>; instructions: string; name: string; notifyOnRun: boolean; enableImmediately: boolean; feeRequired: boolean; feeAmount: number; isPublic: boolean }

const TRIGGERS: Array<{ type: TriggerType; label: string; desc: string; icon: string }> = [
  { type: 'schedule', label: 'Schedule', desc: 'Run at a specific time', icon: 'M12 2v10l4.5 4.5M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
  { type: 'email_event', label: 'Email', desc: 'When an email matches', icon: 'M4 7L10.2 11.65C11.27 12.45 12.73 12.45 13.8 11.65L20 7M3 5h18v14H3z' },
  { type: 'github_event', label: 'GitHub', desc: 'On GitHub activity', icon: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4' },
  { type: 'keyword', label: 'Keyword', desc: 'When you say a phrase', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
  { type: 'manual', label: 'Manual', desc: 'Only when triggered', icon: 'M5 3l14 9-14 9V3z' },
]

const STEPS = ['Trigger', 'Configure', 'Instructions', 'Details', 'Save']

function cronPreview(c: Record<string, unknown>): string {
  const t = (c.time as string) ?? '09:00'; const d = (c.days as number[]) ?? [1,2,3,4,5]
  const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const dh = h===0?12:h>12?h-12:h
  const dn = ['','Mo','Tu','We','Th','Fr','Sa','Su']
  if (d.length===7) return `Daily at ${dh}:${m.toString().padStart(2,'0')} ${ap}`
  if (d.length===5&&!d.includes(6)&&!d.includes(7)) return `Weekdays at ${dh}:${m.toString().padStart(2,'0')} ${ap}`
  return `${d.sort().map(x=>dn[x]).join(', ')} at ${dh}:${m.toString().padStart(2,'0')} ${ap}`
}

export default function NewRecipePage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RecipeForm>({ triggerType: null, triggerConfig: {}, instructions: '', name: '', notifyOnRun: true, enableImmediately: true, feeRequired: false, feeAmount: 0, isPublic: false })
  const [saving, setSaving] = useState(false)
  const u = (up: Partial<RecipeForm>) => setForm({ ...form, ...up })
  const uc = (k: string, v: unknown) => setForm({ ...form, triggerConfig: { ...form.triggerConfig, [k]: v } })

  const suggest = async () => {
    const res = await fetch('/api/recipes/suggest-instructions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger_type: form.triggerType, trigger_config: form.triggerConfig, name: form.name }), credentials: 'include' })
    if (res.ok) u({ instructions: (await res.json()).instructions })
  }

  const save = async () => {
    setSaving(true)
    try { const res = await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, instructions: form.instructions, trigger_type: form.triggerType, trigger_config: form.triggerConfig, enabled: form.enableImmediately, notify_on_run: form.notifyOnRun, fee_amount: form.feeRequired ? form.feeAmount : 0, fee_required: form.feeRequired, is_public: form.isPublic }), credentials: 'include' }); if (res.ok) router.push(`/dashboard/recipes/${(await res.json()).recipe.id}`) } catch {} finally { setSaving(false) }
  }

  return (
    <HarborShell title="New Recipe" showBack backHref="/dashboard/recipes">
      {/* Step dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', margin: '0.75rem 0 1.25rem' }}>
        {STEPS.map((_, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ink)', backgroundColor: i <= step ? 'var(--ink)' : 'var(--cream)' }} />)}
      </div>

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p className="section-title">What triggers this recipe?</p>
          {TRIGGERS.map((t) => (
            <button key={t.type} onClick={() => { u({ triggerType: t.type, triggerConfig: {} }); setStep(1) }} className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', textAlign: 'left' }}>
              <div className="badge-num"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg></div>
              <div><p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem' }}>{t.label}</p><p style={{ fontSize: '0.8rem', opacity: 0.5 }}>{t.desc}</p></div>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="dock-card">
          <p className="section-title">Configure</p>
          {form.triggerType === 'schedule' && (<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div><span className="meta-text">Time</span><input type="time" value={(form.triggerConfig.time as string) ?? '09:00'} onChange={(e) => uc('time', e.target.value)} className="dock-input" style={{ marginTop: '0.25rem' }} /></div>
            <div><span className="meta-text">Days</span><div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {['Mo','Tu','We','Th','Fr','Sa','Su'].map((d, i) => { const ds = (form.triggerConfig.days as number[]) ?? [1,2,3,4,5]; const n = i+1; const on = ds.includes(n); return <button key={d} onClick={() => uc('days', on ? ds.filter(x=>x!==n) : [...ds,n])} style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid var(--ink)', background: on ? 'var(--ink)' : 'var(--cream)', color: on ? 'var(--cream)' : 'var(--ink)', fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>{d}</button> })}
            </div></div>
            <div style={{ border: '1.5px solid var(--ink)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(91,167,205,0.1)' }}><p style={{ fontSize: '0.85rem', color: 'var(--mesh-cyan)', fontFamily: "'Outfit', sans-serif", fontWeight: 500 }}>{cronPreview(form.triggerConfig)}</p></div>
          </div>)}
          {form.triggerType === 'email_event' && (<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}><span className="meta-text">From</span><input type="text" placeholder="boss@company.com" value={(form.triggerConfig.from as string) ?? ''} onChange={(e) => uc('from', e.target.value)} className="dock-input" /><span className="meta-text">Subject contains</span><input type="text" value={(form.triggerConfig.subject_contains as string) ?? ''} onChange={(e) => uc('subject_contains', e.target.value)} className="dock-input" /></div>)}
          {form.triggerType === 'github_event' && (<div><span className="meta-text">Event</span><select value={(form.triggerConfig.event_type as string) ?? ''} onChange={(e) => uc('event_type', e.target.value)} className="dock-input" style={{ marginTop: '0.25rem' }}><option value="">Select...</option><option value="issue_assigned">Issue assigned</option><option value="pr_review_requested">PR review requested</option><option value="new_notification">New notification</option></select></div>)}
          {form.triggerType === 'keyword' && (<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}><span className="meta-text">Phrase</span><input type="text" placeholder="ship it" value={(form.triggerConfig.phrase as string) ?? ''} onChange={(e) => uc('phrase', e.target.value)} className="dock-input" />{(form.triggerConfig.phrase as string) && <div style={{ border: '1.5px solid var(--ink)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(91,167,205,0.1)' }}><p style={{ fontSize: '0.85rem', color: 'var(--mesh-cyan)', fontFamily: "'Outfit', sans-serif", fontWeight: 500 }}>Fires when message contains &quot;{form.triggerConfig.phrase as string}&quot;</p></div>}</div>)}
          {form.triggerType === 'manual' && <p style={{ opacity: 0.5, fontSize: '0.9rem' }}>Only runs when you manually trigger it.</p>}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}><button onClick={() => setStep(0)} className="dock-btn-secondary" style={{ flex: 1 }}>Back</button><button onClick={() => setStep(2)} className="dock-btn-primary" style={{ flex: 1 }}>Next</button></div>
        </div>
      )}

      {step === 2 && (
        <div className="dock-card">
          <p className="section-title">What should Dock do?</p>
          <textarea value={form.instructions} onChange={(e) => u({ instructions: e.target.value })} rows={5} placeholder="Describe in plain English..." className="dock-input" style={{ resize: 'vertical' }} />
          <button onClick={suggest} className="dock-btn-secondary" style={{ marginTop: '0.75rem' }}>✨ Suggest instructions</button>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}><button onClick={() => setStep(1)} className="dock-btn-secondary" style={{ flex: 1 }}>Back</button><button onClick={() => setStep(3)} className="dock-btn-primary" style={{ flex: 1 }}>Next</button></div>
        </div>
      )}

      {step === 3 && (
        <div className="dock-card">
          <p className="section-title">Details</p>
          <span className="meta-text">Recipe name</span>
          <input type="text" value={form.name} onChange={(e) => u({ name: e.target.value })} placeholder="Morning Briefing" className="dock-input" style={{ marginTop: '0.25rem', marginBottom: '0.75rem' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}><span style={{ fontSize: '0.9rem' }}>Notify after each run</span><button className="dock-toggle" data-on={String(form.notifyOnRun)} onClick={() => u({ notifyOnRun: !form.notifyOnRun })}><span className="dock-toggle-knob" style={{ left: form.notifyOnRun ? undefined : '2px', right: form.notifyOnRun ? '2px' : undefined }} /></button></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '0.9rem' }}>Enable immediately</span><button className="dock-toggle" data-on={String(form.enableImmediately)} onClick={() => u({ enableImmediately: !form.enableImmediately })}><span className="dock-toggle-knob" style={{ left: form.enableImmediately ? undefined : '2px', right: form.enableImmediately ? '2px' : undefined }} /></button></div>

          <div style={{ borderTop: '1.5px solid var(--ink)', marginTop: '1rem', paddingTop: '1rem' }}>
            <p className="section-title" style={{ marginBottom: '0.75rem' }}>Monetization</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}><span style={{ fontSize: '0.9rem' }}>Charge a fee</span><button className="dock-toggle" data-on={String(form.feeRequired)} onClick={() => u({ feeRequired: !form.feeRequired, isPublic: !form.feeRequired ? true : form.isPublic })}><span className="dock-toggle-knob" style={{ left: form.feeRequired ? undefined : '2px', right: form.feeRequired ? '2px' : undefined }} /></button></div>
            {form.feeRequired && (
              <div style={{ marginBottom: '0.75rem' }}>
                <span className="meta-text">Fee per run (USDC)</span>
                <input type="number" min={0.01} max={100} step={0.01} value={form.feeAmount || ''} onChange={(e) => u({ feeAmount: Number(e.target.value) })} placeholder="1.00" className="dock-input" style={{ marginTop: '0.25rem' }} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '0.9rem' }}>Make public</span><button className="dock-toggle" data-on={String(form.isPublic)} onClick={() => u({ isPublic: !form.isPublic })}><span className="dock-toggle-knob" style={{ left: form.isPublic ? undefined : '2px', right: form.isPublic ? '2px' : undefined }} /></button></div>
            {form.feeRequired && !form.isPublic && <p style={{ fontSize: '0.75rem', color: 'var(--mesh-peach)', marginTop: '0.25rem' }}>Paid recipes must be public</p>}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}><button onClick={() => setStep(2)} className="dock-btn-secondary" style={{ flex: 1 }}>Back</button><button onClick={() => setStep(4)} className="dock-btn-primary" style={{ flex: 1 }}>Next</button></div>
        </div>
      )}

      {step === 4 && (
        <div className="dock-card">
          <p className="section-title">Review</p>
          <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <p><span style={{ opacity: 0.5 }}>Name:</span> <strong style={{ fontFamily: "'Outfit', sans-serif" }}>{form.name || '(unnamed)'}</strong></p>
            <p><span style={{ opacity: 0.5 }}>Trigger:</span> {form.triggerType}</p>
            <div><span style={{ opacity: 0.5 }}>Instructions:</span><p style={{ marginTop: '0.25rem', opacity: 0.7 }}>{form.instructions}</p></div>
            {form.feeRequired && <p><span style={{ opacity: 0.5 }}>Fee:</span> <strong style={{ fontFamily: "'Outfit', sans-serif" }}>${form.feeAmount.toFixed(2)} USDC</strong> per run</p>}
            {form.isPublic && <p><span style={{ opacity: 0.5 }}>Visibility:</span> Public</p>}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}><button onClick={() => setStep(3)} className="dock-btn-secondary" style={{ flex: 1 }}>Back</button><button onClick={save} disabled={saving || !form.name || !form.instructions} className="dock-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving...' : 'Create Recipe'}</button></div>
        </div>
      )}
    </HarborShell>
  )
}
