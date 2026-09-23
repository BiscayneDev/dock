import { describe, it, expect } from 'vitest'
import { fileMarker, isFileMarker } from '@/spectrum/store'

describe('history file markers', () => {
  it('recognises delivery rows so they stay out of the model context', () => {
    expect(isFileMarker(fileMarker('plan.pdf'))).toBe(true)
    expect(isFileMarker('here is your plan [sent file: plan.pdf]')).toBe(false)
    expect(isFileMarker('hello')).toBe(false)
  })
})
