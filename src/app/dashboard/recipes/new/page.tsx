'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

type TriggerType = 'schedule' | 'email_event' | 'github_event' | 'notion_event' | 'keyword' | 'manual'

interface RecipeForm {
  triggerType: TriggerType | null; triggerConfig: Record<string, unknown>
  instructions: string; name: string; notifyOnRun: boolean; enableImmediately: boolean
}

const TRIGGERS: Array<{ type: TriggerType; icon: string; label: string; desc: string }> = [
  { type: 'schedule', icon: 'ph-clock', label: 'Schedule', desc: 'Run at a specific time' },
  { type: 'email_event', icon: 'ph-envelope', label: 'Email', desc: 'When an email matches' },
  { type: 'github_event', icon: 'ph-github-logo', label: 'GitHub', desc: 'On GitHub activity' },
  { type: 'notion_event', icon: 'ph-notepad', label: 'Notion', desc: 'On database changes' },
  { type: 'keyword', icon: 'ph-chat-teardrop-text', label: 'Keyword', desc: 'When you say a phrase' },
  { type: 'manual', icon: 'ph-play', label: 'Manual', desc: 'Only when triggered' },
]

const STEPS = ['Trigger', 'Configure', 'Instructions', 'Details', 'Save']

function buildCronPreview(config: Record<string, unknown>): string {
  const time = (config.time as string) ?? '09:00'
  const days = (config.days as number[]) ?? [1, 2, 3, 4, 5]
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  if (days.length === 7) return `Every day at ${dh}:${m.toString().padStart(2, '0')} ${ampm}`
  if (days.length === 5 && !days.includes(6) && !days.includes(7)) return `Weekdays at ${dh}:${m.toString().padStart(2, '0')} ${ampm}`
  return `${days.sort().map((d) => dayNames[d]).join(', ')} at ${dh}:${m.toString().padStart(2, '0')} ${ampm}`
}

export default function NewRecipePage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RecipeForm>({
    triggerType: null, triggerConfig: {}, instructions: '', name: '', notifyOnRun: true, enableImmediately: true,
  })
  const [saving, setSaving] = useState(false)

  const updateForm = (u: Partial<RecipeForm>) => setForm({ ...form, ...u })
  const updateConfig = (k: string, v: unknown) => setForm({ ...form, triggerConfig: { ...form.triggerConfig, [k]: v } })

  const suggestInstructions = async () => {
    const res = await fetch('/api/recipes/suggest-instructions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_type: form.triggerType, trigger_config: form.triggerConfig, name: form.name }),
      credentials: 'include',
    })
    if (res.ok) { const data = await res.json(); updateForm({ instructions: data.instructions }) }
  }

  const saveRecipe = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, instructions: form.instructions, trigger_type: form.triggerType,
          trigger_config: form.triggerConfig, enabled: form.enableImmediately, notify_on_run: form.notifyOnRun,
        }),
        credentials: 'include',
      })
      if (res.ok) { const data = await res.json(); router.push(`/dashboard/recipes/${data.recipe.id}`) }
    } catch { /* Failed */ } finally { setSaving(false) }
  }

  return (
    <HarborShell title="New Recipe" showBack backHref="/dashboard/recipes">
      {/* Step dots */}
      <div className="flex items-center justify-center gap-2 my-4">
        {STEPS.map((_, i) => (
          <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-slate-700' : i < step ? 'bg-slate-400' : 'bg-slate-300/50'}`} />
        ))}
      </div>

      {/* Step 0: Trigger type */}
      {step === 0 && (
        <div className="space-y-2">
          <p className="text-[15px] text-slate-500 mb-3" style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }}>What triggers this recipe?</p>
          {TRIGGERS.map((t) => (
            <button key={t.type} onClick={() => { updateForm({ triggerType: t.type, triggerConfig: {} }); setStep(1) }}
              className="glass-card glass-card-hover w-full rounded-[20px] p-4 flex items-center gap-3 text-left transition-transform">
              <div className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center flex-shrink-0">
                <i className={`ph-fill ${t.icon} text-[20px] text-slate-600`} />
              </div>
              <div>
                <p className="font-medium text-slate-700 text-[15px]">{t.label}</p>
                <p className="text-[13px] text-slate-400">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 1: Configure trigger */}
      {step === 1 && (
        <div className="glass-card rounded-[20px] p-5 space-y-4">
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }} className="text-slate-700">Configure</p>

          {form.triggerType === 'schedule' && (
            <>
              <div>
                <label className="text-[12px] text-slate-400 uppercase tracking-wide">Time</label>
                <input type="time" value={(form.triggerConfig.time as string) ?? '09:00'}
                  onChange={(e) => updateConfig('time', e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" />
              </div>
              <div>
                <label className="text-[12px] text-slate-400 uppercase tracking-wide mb-2 block">Days</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
                    const days = (form.triggerConfig.days as number[]) ?? [1, 2, 3, 4, 5]
                    const n = i + 1; const active = days.includes(n)
                    return (
                      <button key={day} onClick={() => updateConfig('days', active ? days.filter((d) => d !== n) : [...days, n])}
                        className={`w-10 h-10 rounded-full text-[12px] font-medium transition-colors ${active ? 'bg-slate-800 text-white' : 'bg-white/50 text-slate-400'}`}>
                        {day.slice(0, 2)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="bg-white/40 rounded-xl px-3 py-2 mt-1">
                <p className="text-[12px] text-blue-500">{buildCronPreview(form.triggerConfig)}</p>
              </div>
            </>
          )}
          {form.triggerType === 'email_event' && (
            <>
              <div><label className="text-[12px] text-slate-400 uppercase tracking-wide">From</label>
                <input type="text" placeholder="boss@company.com" value={(form.triggerConfig.from as string) ?? ''}
                  onChange={(e) => updateConfig('from', e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" /></div>
              <div><label className="text-[12px] text-slate-400 uppercase tracking-wide">Subject contains</label>
                <input type="text" value={(form.triggerConfig.subject_contains as string) ?? ''}
                  onChange={(e) => updateConfig('subject_contains', e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" /></div>
            </>
          )}
          {form.triggerType === 'github_event' && (
            <div><label className="text-[12px] text-slate-400 uppercase tracking-wide">Event</label>
              <select value={(form.triggerConfig.event_type as string) ?? ''} onChange={(e) => updateConfig('event_type', e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1">
                <option value="">Select...</option>
                <option value="issue_assigned">Issue assigned</option>
                <option value="pr_review_requested">PR review requested</option>
                <option value="new_notification">New notification</option>
              </select></div>
          )}
          {form.triggerType === 'keyword' && (
            <>
              <div><label className="text-[12px] text-slate-400 uppercase tracking-wide">Phrase</label>
                <input type="text" placeholder="ship it" value={(form.triggerConfig.phrase as string) ?? ''}
                  onChange={(e) => updateConfig('phrase', e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" /></div>
              {(form.triggerConfig.phrase as string) && (
                <div className="bg-white/40 rounded-xl px-3 py-2">
                  <p className="text-[12px] text-blue-500">Fires when message contains &quot;{form.triggerConfig.phrase as string}&quot;</p>
                </div>
              )}
            </>
          )}
          {form.triggerType === 'manual' && <p className="text-[13px] text-slate-400">Only runs when you manually trigger it.</p>}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(0)} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">Back</button>
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium">Next</button>
          </div>
        </div>
      )}

      {/* Step 2: Instructions */}
      {step === 2 && (
        <div className="glass-card rounded-[20px] p-5 space-y-4">
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }} className="text-slate-700">What should Dock do?</p>
          <textarea value={form.instructions} onChange={(e) => updateForm({ instructions: e.target.value })} rows={5}
            placeholder="Describe in plain English..."
            className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 resize-y" />
          <button onClick={suggestInstructions}
            className="w-full py-2 rounded-xl bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500 hover:bg-white/70 transition-colors">
            ✨ Suggest instructions
          </button>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">Back</button>
            <button onClick={() => setStep(3)} className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium">Next</button>
          </div>
        </div>
      )}

      {/* Step 3: Details */}
      {step === 3 && (
        <div className="glass-card rounded-[20px] p-5 space-y-4">
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }} className="text-slate-700">Details</p>
          <div>
            <label className="text-[12px] text-slate-400 uppercase tracking-wide">Recipe name</label>
            <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="Morning Briefing"
              className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" />
          </div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[14px] text-slate-600">Notify after each run</span>
            <button onClick={() => updateForm({ notifyOnRun: !form.notifyOnRun })}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.notifyOnRun ? 'bg-emerald-400' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.notifyOnRun ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[14px] text-slate-600">Enable immediately</span>
            <button onClick={() => updateForm({ enableImmediately: !form.enableImmediately })}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.enableImmediately ? 'bg-emerald-400' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.enableImmediately ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">Back</button>
            <button onClick={() => setStep(4)} className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium">Next</button>
          </div>
        </div>
      )}

      {/* Step 4: Save */}
      {step === 4 && (
        <div className="glass-card rounded-[20px] p-5 space-y-3">
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }} className="text-slate-700">Review</p>
          <div className="space-y-2 text-[13px]">
            <p><span className="text-slate-400">Name:</span> <span className="text-slate-700">{form.name || '(unnamed)'}</span></p>
            <p><span className="text-slate-400">Trigger:</span> <span className="text-slate-700">{form.triggerType}</span></p>
            <p><span className="text-slate-400">Notify:</span> <span className="text-slate-700">{form.notifyOnRun ? 'Yes' : 'No'}</span></p>
            <div>
              <p className="text-slate-400">Instructions:</p>
              <p className="text-slate-600 mt-1">{form.instructions}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(3)} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">Back</button>
            <button onClick={saveRecipe} disabled={saving || !form.name || !form.instructions}
              className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Create Recipe'}
            </button>
          </div>
        </div>
      )}
    </HarborShell>
  )
}
