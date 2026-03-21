'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

type TriggerType = 'schedule' | 'email_event' | 'github_event' | 'notion_event' | 'keyword' | 'manual'

interface RecipeForm {
  triggerType: TriggerType | null
  triggerConfig: Record<string, unknown>
  instructions: string
  name: string
  notifyOnRun: boolean
  enableImmediately: boolean
}

const TRIGGER_OPTIONS: Array<{ type: TriggerType; icon: string; label: string; desc: string }> = [
  { type: 'schedule', icon: '🕐', label: 'Schedule', desc: 'Run at a specific time or interval' },
  { type: 'email_event', icon: '📧', label: 'Email', desc: 'Run when an email matches your criteria' },
  { type: 'github_event', icon: '🐙', label: 'GitHub', desc: 'Run when GitHub activity occurs' },
  { type: 'notion_event', icon: '📝', label: 'Notion', desc: 'Run when a Notion database changes' },
  { type: 'keyword', icon: '💬', label: 'Keyword', desc: 'Run when you say a specific phrase in Telegram' },
  { type: 'manual', icon: '▶️', label: 'Manual', desc: 'Run only when you explicitly trigger it' },
]

const STEPS = ['Trigger Type', 'Configure', 'Instructions', 'Name & Settings', 'Test', 'Save']

export default function NewRecipePage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RecipeForm>({
    triggerType: null,
    triggerConfig: {},
    instructions: '',
    name: '',
    notifyOnRun: true,
    enableImmediately: true,
  })
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const updateForm = (updates: Partial<RecipeForm>) => {
    setForm({ ...form, ...updates })
  }

  const updateConfig = (key: string, value: unknown) => {
    setForm({ ...form, triggerConfig: { ...form.triggerConfig, [key]: value } })
  }

  const suggestInstructions = async () => {
    const res = await fetch('/api/recipes/suggest-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_type: form.triggerType,
        trigger_config: form.triggerConfig,
        name: form.name,
      }),
      credentials: 'include',
    })
    if (res.ok) {
      const data = await res.json()
      updateForm({ instructions: data.instructions })
    }
  }

  const testRecipe = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // First save as draft, then run as test
      const createRes = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || 'Test Recipe',
          instructions: form.instructions,
          trigger_type: form.triggerType,
          trigger_config: form.triggerConfig,
          enabled: false,
          notify_on_run: false,
        }),
        credentials: 'include',
      })

      if (!createRes.ok) {
        setTestResult('Failed to create test recipe.')
        return
      }

      const { recipe } = await createRes.json()

      // Trigger a test run
      await fetch(`/api/recipes/${recipe.id}/run`, {
        method: 'POST',
        credentials: 'include',
      })

      // Poll for result
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const runsRes = await fetch(`/api/recipes/${recipe.id}/runs`, {
          credentials: 'include',
        })
        if (runsRes.ok) {
          const { runs } = await runsRes.json()
          const latest = runs[0]
          if (latest && latest.status !== 'running') {
            setTestResult(latest.output ?? latest.error ?? 'Completed')
            // Clean up test recipe
            await fetch(`/api/recipes/${recipe.id}`, {
              method: 'DELETE',
              credentials: 'include',
            })
            return
          }
        }
      }
      setTestResult('Test timed out.')
    } catch {
      setTestResult('Test failed.')
    } finally {
      setTesting(false)
    }
  }

  const saveRecipe = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          instructions: form.instructions,
          trigger_type: form.triggerType,
          trigger_config: form.triggerConfig,
          enabled: form.enableImmediately,
          notify_on_run: form.notifyOnRun,
        }),
        credentials: 'include',
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/dashboard/recipes/${data.recipe.id}`)
      }
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">New Recipe</h1>

        {/* Step indicator */}
        <div className="flex gap-1 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div
                className={`h-1 rounded-full ${i <= step ? 'bg-cyan-500' : 'bg-zinc-800'}`}
              />
              <p className={`mt-1 text-xs ${i === step ? 'text-cyan-400' : 'text-zinc-600'}`}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Step 0: Trigger type */}
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {TRIGGER_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => {
                  updateForm({ triggerType: opt.type, triggerConfig: {} })
                  setStep(1)
                }}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  form.triggerType === opt.type
                    ? 'border-cyan-500 bg-cyan-950/30'
                    : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
                }`}
              >
                <span className="text-2xl">{opt.icon}</span>
                <h3 className="mt-1 font-medium text-zinc-100">{opt.label}</h3>
                <p className="text-sm text-zinc-400">{opt.desc}</p>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: Configure trigger */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">Configure Trigger</h2>

            {form.triggerType === 'schedule' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Time</label>
                  <input
                    type="time"
                    value={(form.triggerConfig.time as string) ?? '09:00'}
                    onChange={(e) => updateConfig('time', e.target.value)}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Days</label>
                  <div className="flex gap-2 flex-wrap">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
                      const days = (form.triggerConfig.days as number[]) ?? [1, 2, 3, 4, 5]
                      const dayNum = i + 1
                      const active = days.includes(dayNum)
                      return (
                        <button
                          key={day}
                          onClick={() => {
                            const newDays = active
                              ? days.filter((d) => d !== dayNum)
                              : [...days, dayNum]
                            updateConfig('days', newDays)
                          }}
                          className={`rounded-md px-3 py-1 text-sm ${
                            active
                              ? 'bg-cyan-600 text-white'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {form.triggerType === 'email_event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">From (email or domain)</label>
                  <input
                    type="text"
                    value={(form.triggerConfig.from as string) ?? ''}
                    onChange={(e) => updateConfig('from', e.target.value)}
                    placeholder="boss@company.com"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Subject contains</label>
                  <input
                    type="text"
                    value={(form.triggerConfig.subject_contains as string) ?? ''}
                    onChange={(e) => updateConfig('subject_contains', e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(form.triggerConfig.has_attachment as boolean) ?? false}
                    onChange={(e) => updateConfig('has_attachment', e.target.checked)}
                    className="rounded border-zinc-600"
                  />
                  <span className="text-sm text-zinc-300">Has attachment</span>
                </label>
              </div>
            )}

            {form.triggerType === 'github_event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Event type</label>
                  <select
                    value={(form.triggerConfig.event_type as string) ?? ''}
                    onChange={(e) => updateConfig('event_type', e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  >
                    <option value="">Select...</option>
                    <option value="issue_assigned">Issue assigned to me</option>
                    <option value="pr_review_requested">PR review requested</option>
                    <option value="new_notification">New notification</option>
                    <option value="issue_opened">Issue opened</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Repository (optional)</label>
                  <input
                    type="text"
                    value={(form.triggerConfig.repo as string) ?? ''}
                    onChange={(e) => updateConfig('repo', e.target.value)}
                    placeholder="owner/repo"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
              </div>
            )}

            {form.triggerType === 'notion_event' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Database ID</label>
                  <input
                    type="text"
                    value={(form.triggerConfig.database_id as string) ?? ''}
                    onChange={(e) => updateConfig('database_id', e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Event</label>
                  <div className="flex gap-3">
                    {['new_page', 'page_updated'].map((evt) => (
                      <label key={evt} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="notion_event"
                          checked={form.triggerConfig.event === evt}
                          onChange={() => updateConfig('event', evt)}
                          className="text-cyan-500"
                        />
                        <span className="text-sm text-zinc-300">
                          {evt === 'new_page' ? 'New page' : 'Page updated'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {form.triggerType === 'keyword' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Phrase</label>
                  <input
                    type="text"
                    value={(form.triggerConfig.phrase as string) ?? ''}
                    onChange={(e) => updateConfig('phrase', e.target.value)}
                    placeholder="ship it"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Match type</label>
                  <div className="flex gap-3">
                    {(['exact', 'contains', 'starts_with'] as const).map((mt) => (
                      <label key={mt} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="match_type"
                          checked={(form.triggerConfig.match_type ?? 'contains') === mt}
                          onChange={() => updateConfig('match_type', mt)}
                          className="text-cyan-500"
                        />
                        <span className="text-sm text-zinc-300">{mt.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(form.triggerConfig.case_sensitive as boolean) ?? false}
                    onChange={(e) => updateConfig('case_sensitive', e.target.checked)}
                    className="rounded border-zinc-600"
                  />
                  <span className="text-sm text-zinc-300">Case sensitive</span>
                </label>
              </div>
            )}

            {form.triggerType === 'manual' && (
              <p className="text-zinc-400">This recipe only runs when you manually trigger it.</p>
            )}

            <div className="flex gap-2 pt-4">
              <button onClick={() => setStep(0)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                Back
              </button>
              <button onClick={() => setStep(2)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white">
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Instructions */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">Instructions</h2>
            <textarea
              value={form.instructions}
              onChange={(e) => updateForm({ instructions: e.target.value })}
              placeholder="Describe what Dock should do in plain English. Be specific about what to check, how to format the output, and what to skip."
              rows={6}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 resize-y"
            />
            <button
              onClick={suggestInstructions}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
            >
              ✨ Suggest instructions
            </button>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(1)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                Back
              </button>
              <button onClick={() => setStep(3)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white">
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Name & settings */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">Name & Settings</h2>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Recipe name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="Morning Briefing"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifyOnRun}
                onChange={(e) => updateForm({ notifyOnRun: e.target.checked })}
                className="rounded border-zinc-600"
              />
              <span className="text-zinc-300">Notify me after each run</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enableImmediately}
                onChange={(e) => updateForm({ enableImmediately: e.target.checked })}
                className="rounded border-zinc-600"
              />
              <span className="text-zinc-300">Enable immediately</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(2)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                Back
              </button>
              <button onClick={() => setStep(4)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white">
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Test */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">Test Run (Optional)</h2>
            <p className="text-sm text-zinc-400">
              Run a test to see what this recipe would output. No Telegram message will be sent.
            </p>
            <button
              onClick={testRecipe}
              disabled={testing}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {testing ? 'Running test...' : '🧪 Test this recipe now'}
            </button>
            {testResult && (
              <div className="rounded-md border border-zinc-700 bg-zinc-900 p-4">
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap">{testResult}</pre>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(3)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                Back
              </button>
              <button onClick={() => setStep(5)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white">
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Save */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">Review & Save</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
              <p><span className="text-zinc-400">Name:</span> <span className="text-zinc-100">{form.name || '(unnamed)'}</span></p>
              <p><span className="text-zinc-400">Trigger:</span> <span className="text-zinc-100">{form.triggerType}</span></p>
              <p><span className="text-zinc-400">Notify:</span> <span className="text-zinc-100">{form.notifyOnRun ? 'Yes' : 'No'}</span></p>
              <p><span className="text-zinc-400">Enabled:</span> <span className="text-zinc-100">{form.enableImmediately ? 'Yes' : 'No'}</span></p>
              <div>
                <p className="text-zinc-400">Instructions:</p>
                <p className="text-zinc-300 text-sm mt-1">{form.instructions}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(4)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                Back
              </button>
              <button
                onClick={saveRecipe}
                disabled={saving || !form.name || !form.instructions}
                className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Recipe'}
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
