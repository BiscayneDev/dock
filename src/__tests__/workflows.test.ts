import { describe, expect, it } from 'vitest'
import { needsChanged, planRun, renderWorkflowDraft, runTask, validateWorkflow } from '@/lib/workflows/model'
import { buildWorld, CAPABILITY_HANDLERS } from '@/lib/dry-run/world'
import { deriveAction } from '@/lib/dry-run/run'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

const ok = (v: ReturnType<typeof validateWorkflow>) => { if (!v.ok) throw new Error(v.error); return v.def }

describe('workflow model', () => {
  it('accepts a read-only workflow and normalizes the site', () => {
    const d = ok(validateWorkflow({ name: ' check   expenses ', steps: ['open reports', 'read totals'], needs: ['https://www.concur.com/'] }))
    expect(d.name).toBe('check expenses')
    expect(d.needs).toEqual(['concur.com'])
  })
  it('rejects steps that send as the user, spend, or touch secrets', () => {
    for (const step of ['email my boss as me the totals', 'buy the cheapest one', 'enter my password', 'change my account settings']) {
      expect(validateWorkflow({ name: 'x', steps: [step] }).ok).toBe(false)
    }
  })
  it('rejects denylisted sites, many sites, empty and oversized input', () => {
    expect(validateWorkflow({ name: 'x', steps: ['a'], needs: ['chase.com'] }).ok).toBe(false)
    expect(validateWorkflow({ name: 'x', steps: ['a'], needs: ['github.com', 'notion.so'] }).ok).toBe(false)
    expect(validateWorkflow({ name: '', steps: ['a'] }).ok).toBe(false)
    expect(validateWorkflow({ name: 'x', steps: [] }).ok).toBe(false)
    expect(validateWorkflow({ name: 'x', steps: Array(13).fill('a') }).ok).toBe(false)
  })
  it('fails closed when a needed login is gone', () => {
    const d = ok(validateWorkflow({ name: 'x', steps: ['a'], needs: ['concur.com'] }))
    const p = planRun(d, [])
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toContain('concur.com')
    expect(planRun(d, ['concur.com'])).toEqual({ ok: true, site: 'concur.com' })
  })
  it('flags widened needs and renders the draft with the safety line', () => {
    const a = ok(validateWorkflow({ name: 'x', steps: ['a'], needs: [] }))
    const b = ok(validateWorkflow({ name: 'x', steps: ['a'], needs: ['github.com'] }))
    expect(needsChanged(a, b)).toBe(true)
    expect(renderWorkflowDraft(b, false)).toContain('read-only')
    expect(renderWorkflowDraft(b, true)).toMatch(/^Replace/)
    expect(runTask(a)).toContain('1. a')
  })
})

describe('workflow dry-run twins', () => {
  const world = () => buildWorld({ user: 'user-a', grants: [{ site: 'concur.com' }], workflows: [{ name: 'expenses', steps: ['open reports'], needs: ['concur.com'] }, { user: 'user-b', name: 'secret', steps: ['x'] }], recipes: [{ name: 'friday sleep text' }] })
  it('lists only the acting user\'s workflows', () => {
    const r = CAPABILITY_HANDLERS.workflow_list({}, world())
    expect(JSON.stringify(r.data)).toContain('expenses')
    expect(JSON.stringify(r.data)).not.toContain('secret')
  })
  it('run proposes with a live grant and fails closed after revoke', () => {
    const w = world()
    expect((CAPABILITY_HANDLERS.workflow_run({ name: 'expenses' }, w).data as { status: string }).status).toBe('awaiting_user_confirmation')
    CAPABILITY_HANDLERS.browser_disconnect({ site: 'concur.com' }, w)
    const r = CAPABILITY_HANDLERS.workflow_run({ name: 'expenses' }, w)
    expect(r.success).toBe(false)
    expect(r.error).toContain("isn't connected")
  })
  it('cannot run or delete another user\'s workflow', () => {
    const w = world()
    expect(CAPABILITY_HANDLERS.workflow_run({ name: 'secret' }, w).success).toBe(false)
    expect(CAPABILITY_HANDLERS.workflow_delete({ name: 'secret' }, w).success).toBe(false)
  })
  it('update shows the full new version; delete and recipe_delete work per user', () => {
    const w = world()
    const u = CAPABILITY_HANDLERS.workflow_update({ name: 'expenses', steps: ['attach the PDF'] }, w)
    expect(JSON.stringify(u.data)).toContain('attach the PDF')
    expect(CAPABILITY_HANDLERS.workflow_delete({ name: 'expenses' }, w).success).toBe(true)
    expect(CAPABILITY_HANDLERS.recipe_delete({ id: 'friday sleep text' }, w).success).toBe(true)
    expect(CAPABILITY_HANDLERS.recipe_list({}, w).data).toEqual({ recipes: [] })
  })
  it('maps tool calls to actions and the prompt names the tools', () => {
    expect(deriveAction([{ name: 'workflow_run', input: {}, status: 'proposed' }])).toBe('run_workflow')
    expect(deriveAction([{ name: 'workflow_update', input: {}, status: 'proposed' }])).toBe('update_workflow_readback')
    const p = buildSystemPrompt([], false, { google: true, wallet: false, computer: true })
    for (const t of ['workflow_save', 'workflow_run', 'workflow_update', 'workflow_delete', 'workflow_list']) expect(p).toContain(t)
  })
})
