import { describe, it, expect } from 'vitest'
import { senderAddress } from '@/lib/spectrum/waitlist-invites'

describe('senderAddress', () => {
  it('reads address, then id, from the iMessage sender ref', () => {
    expect(senderAddress({ id: '+17193933639', address: '+17193933639' })).toBe('+17193933639')
    expect(senderAddress({ id: '+17193933639' })).toBe('+17193933639')
  })
  it('is null when there is no sender or the id is empty', () => {
    expect(senderAddress(undefined)).toBeNull()
    expect(senderAddress({ id: '' })).toBeNull()
  })
})
