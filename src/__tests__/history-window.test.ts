import { describe, expect, it } from 'vitest'
import { windowHistory, withVolatileNote, MIN_KEEP } from '@/lib/spectrum/history-window'

const msgs = (n: number, len = 10) => Array.from({ length: n }, (_, i) => ({ role: 'user', content: String(i).padEnd(len, 'x') }))

describe('windowHistory', () => {
  it('leaves short histories alone', () => { expect(windowHistory(msgs(4))).toHaveLength(4) })
  it('caps by message count, keeping the newest', () => {
    const w = windowHistory(msgs(20))
    expect(w).toHaveLength(10)
    expect(w[w.length - 1]!.content.startsWith('19')).toBe(true)
  })
  it('caps by characters but never below the minimum', () => {
    expect(windowHistory(msgs(20, 3000))).toHaveLength(MIN_KEEP)
    expect(windowHistory(msgs(20, 1000)).length).toBeLessThanOrEqual(8)
  })
})

describe('withVolatileNote', () => {
  it('inserts the note just before the newest message, prefix untouched', () => {
    const base = [{ role: 'system', content: 's' }, { role: 'user', content: 'a' }, { role: 'user', content: 'now' }]
    const out = withVolatileNote(base, 'clock 9:00:01')
    expect(out.map((m) => m.content)).toEqual(['s', 'a', 'clock 9:00:01', 'now'])
    const next = withVolatileNote(base, 'clock 9:00:02')
    expect(next.slice(0, 2)).toEqual(out.slice(0, 2))
  })
  it('is a no-op with no note', () => { expect(withVolatileNote([{ role: 'user', content: 'a' }], ' ')).toHaveLength(1) })
})
