import { describe, it, expect } from 'vitest'
import { toPlainText } from '@/lib/spectrum/plain-text'

describe('toPlainText', () => {
    it('strips bold, italic, strikethrough and inline code', () => {
        expect(toPlainText('**MoonPay** launched *today* with `api` and ~~old~~ new')).toBe('MoonPay launched today with api and old new')
        expect(toPlainText('__big__ and _small_')).toBe('big and small')
    })
    it('drops headings, quotes and rules; normalizes bullets', () => {
        expect(toPlainText('## Top launches\n> quoted\n---\n* one\n+ two\n- three\n1. four')).toBe('Top launches\nquoted\n\n- one\n- two\n- three\n1. four')
    })
    it('turns links into text plus url', () => {
        expect(toPlainText('See [the post](https://x.com/a/b) now')).toBe('See the post (https://x.com/a/b) now')
        expect(toPlainText('[https://getdinghy.sh](https://getdinghy.sh)')).toBe('https://getdinghy.sh')
    })
    it('keeps code block contents', () => {
        expect(toPlainText('Run:\n```bash\nnpm i\n```\ndone')).toBe('Run:\nnpm i\ndone')
    })
    it('leaves urls, emails, snake_case and math alone', () => {
        const s = 'https://example.com/a_b_c/*x* mail a_b@c.co my_var_name 2 * 3 * 4'
        expect(toPlainText(s)).toBe(s)
    })
    it('passes plain text through unchanged', () => {
        const s = "You're in - welcome to Dinghy.\n\nText me whatever you need."
        expect(toPlainText(s)).toBe(s)
    })
})
