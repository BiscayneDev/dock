import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeRun } from '../src/executor.mjs'
import { isMoneyAction } from '../src/money.mjs'

test('money approval precedes isolated runner even when both fields exist', async () => {
  const action = { id: 'fictional', type: 'x402_spend' }
  assert.equal(isMoneyAction(action), true)
  let invoked = false
  const completed = []
  const api = { event: async () => {}, complete: async (id, body) => completed.push(body) }
  const result = await executeRun({ id: 'fictional-run', proposedAction: action, isolatedTask: { taskRef: 'task-1' } }, { api, isolatedRunner: async () => { invoked = true } })
  assert.equal(invoked, false)
  assert.equal(result.outcome, 'awaiting_approval')
  assert.equal(completed[0].status, 'awaiting_approval')
})

test('home isolated executor is disabled by default, without infer fallback', async () => {
  const old = process.env.DOCK_ISOLATED_RUNTIME
  delete process.env.DOCK_ISOLATED_RUNTIME
  try {
    let invoked = false
    const completed = []
    const api = { event: async () => {}, complete: async (id, body) => completed.push(body), infer: async () => { throw new Error('must not infer') } }
    const result = await executeRun({ id: 'fictional-run', isolatedTask: { taskRef: 'task-1' } }, { api, isolatedRunner: async () => { invoked = true } })
    assert.equal(invoked, false)
    assert.equal(result.outcome, 'failed')
    assert.match(completed[0].error, /disabled/)
  } finally {
    if (old === undefined) delete process.env.DOCK_ISOLATED_RUNTIME
    else process.env.DOCK_ISOLATED_RUNTIME = old
  }
})
