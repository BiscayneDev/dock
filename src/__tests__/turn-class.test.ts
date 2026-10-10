import { describe, expect, it } from 'vitest'
import { classForIteration, classifyUserTurn, hintHeaders } from '@/lib/spectrum/turn-class'

describe('classifyUserTurn', () => {
  it('local lookups and questions are lookup', () => {
    expect(classifyUserTurn('I\'m in Singapore, where should I eat chicken rice near Parkroyal Pickering?')).toBe('lookup')
    expect(classifyUserTurn('what time is it in Tokyo?')).toBe('lookup')
  })
  it('research words and long asks are research', () => {
    expect(classifyUserTurn('compare the best personal AI agents')).toBe('research')
    expect(classifyUserTurn('x'.repeat(401))).toBe('research')
  })
  it('short statements are chat', () => {
    expect(classifyUserTurn('thanks, that works')).toBe('chat')
  })
})

describe('classForIteration', () => {
  it('turns later iterations into synthesis, except research and background', () => {
    expect(classForIteration('lookup', 1)).toBe('lookup')
    expect(classForIteration('lookup', 2)).toBe('synthesize')
    expect(classForIteration('research', 3)).toBe('research')
    expect(classForIteration('background', 2)).toBe('background')
  })
})

describe('hintHeaders', () => {
  it('sends class, tools flag and budget; no budget for background; nothing when unset', () => {
    expect(hintHeaders('lookup', true)).toEqual({ 'x-dinghy-task-class': 'lookup', 'x-dinghy-needs-tools': '1', 'x-dinghy-latency-budget-ms': '12000' })
    expect(hintHeaders('background', false)).toEqual({ 'x-dinghy-task-class': 'background', 'x-dinghy-needs-tools': '0' })
    expect(hintHeaders(undefined, true)).toEqual({})
  })
})
