import { describe, expect, it } from 'vitest'
import { composeFirstLook, phoneFromChatGuid } from '@/lib/spectrum/first-look'
import { firstLookCopy, startReadyPath, startSmsLink, START_CONNECT_REQUEST, START_FIRST_TEXT } from '@/lib/spectrum/start-link'
import { isConnectRequest } from '@/lib/spectrum/connect-lines'

describe('start first look', () => {
  it('the start connect request still reads as a plain connect request', () => {
    expect(isConnectRequest(START_CONNECT_REQUEST)).toBe(true)
  })
  it('gets the phone out of a chat guid, and nothing else', () => {
    expect(phoneFromChatGuid('any;-;+16784680733')).toBe('+16784680733')
    expect(phoneFromChatGuid('any;+;chat123')).toBeNull()
    expect(phoneFromChatGuid('+16784680733')).toBeNull()
  })
  it('joins finding and digest, and says nothing when both are empty', () => {
    expect(composeFirstLook('First look: a.', 'Done reading. b.')).toBe('First look: a.\n\nDone reading. b.')
    expect(composeFirstLook(null, 'Done reading. b.')).toBe('Done reading. b.')
    expect(composeFirstLook(null, null)).toBeNull()
    expect(composeFirstLook('  ', '')).toBeNull()
  })
  it('page copy for every state, none carrying Google content', () => {
    expect(firstLookCopy('pending').done).toBe(false)
    expect(firstLookCopy(null).done).toBe(false)
    for (const s of ['ready', 'empty', 'failed', 'sent'] as const) expect(firstLookCopy(s).done).toBe(true)
    expect(firstLookCopy('empty').title).toMatch(/quiet/)
  })
  it('builds the ready path and a prefilled text link', () => {
    expect(startReadyPath('abc')).toBe('/start/abc/ready')
    expect(startSmsLink('+16286297000', START_FIRST_TEXT)).toBe('sms:+16286297000?&body=Hi')
  })
})
