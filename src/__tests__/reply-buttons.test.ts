import { describe, expect, it } from 'vitest'
import { flattenBlocks, renderHtml, replyHref, splitBlocks } from '@/lib/files/render'

const body = ':::reply\nBook the lodge\nShow me cheaper options & dates\n- Remind me Aug 4\nA fourth one\n:::'

describe('reply buttons', () => {
    it('builds sms links that prefill the exact text', () => {
        expect(replyHref('+16286297000', 'Book the lodge')).toBe('sms:+16286297000?&body=Book%20the%20lodge')
        expect(replyHref('+16286297000', 'a & b?')).toBe('sms:+16286297000?&body=a%20%26%20b%3F')
    })
    it('refuses a bad line or empty text', () => {
        expect(replyHref('6286297000', 'x')).toBeNull()
        expect(replyHref('+1; drop', 'x')).toBeNull()
        expect(replyHref('+16286297000', '')).toBeNull()
    })
    it('renders at most 3 buttons as links to the line', () => {
        const h = renderHtml({ title: 'T', body }, { replyLine: '+16286297000' })
        expect(h.match(/class="reply"/g)?.length).toBe(3)
        expect(h).toContain('href="sms:+16286297000?&amp;body=Book%20the%20lodge"')
        expect(h).toContain('Show me cheaper options &amp; dates')
        expect(h).toContain('Remind me Aug 4')
        expect(h).not.toContain('A fourth one')
    })
    it('shows plain suggestions, not dead links, when no line is known', () => {
        const h = renderHtml({ title: 'T', body })
        expect(h).not.toContain('sms:')
        expect(h).toContain('reply-off')
    })
    it('escapes text and drops overlong lines', () => {
        const h = renderHtml({ title: 'T', body: `:::reply\n<img src=x onerror=1>\n${'x'.repeat(130)}\n:::` }, { replyLine: '+16286297000' })
        expect(h).not.toContain('<img src=x')
        expect(h.match(/class="reply"/g)?.length).toBe(1)
    })
    it('flattens to plain lines for pdf and keeps unclosed blocks as text', () => {
        expect(flattenBlocks(body)).toContain('- Reply with: Book the lodge')
        expect(splitBlocks(':::reply\nhi').every((s) => s.kind === 'md')).toBe(true)
    })
})
