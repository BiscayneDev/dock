import { describe, expect, it } from 'vitest'
import { flattenBlocks, renderHtml } from '@/lib/files/render'

const body = [
    ':::options',
    'Lakeside Lodge | $1,380 | Best rate, lake view | Two-night minimum',
    'Pine Inn | $990 | Cheapest | No cancellation',
    'Just a name',
    ':::',
    ':::sources',
    'Lodge rate | https://www.lakeside.example/rates | Oct 8',
    'Cancellation policy | javascript:alert(1) | Oct 9',
    'Reviews',
    ':::',
].join('\n')

describe('option cards', () => {
    const h = renderHtml({ title: 'T', body })
    it('shows name, price, why and the catch', () => {
        expect(h).toContain('class="opt-name">Lakeside Lodge')
        expect(h).toContain('$1,380')
        expect(h).toContain('Best rate, lake view')
        expect(h).toContain('<span>Catch</span>Two-night minimum')
    })
    it('handles short lines and caps at 5 cards', () => {
        expect(h).toContain('Just a name')
        const many = ':::options\n' + Array.from({ length: 8 }, (_, i) => `O${i} | $1`).join('\n') + '\n:::'
        expect(renderHtml({ title: 'T', body: many }).match(/class="opt"/g)?.length).toBe(5)
    })
    it('escapes text', () => {
        expect(renderHtml({ title: 'T', body: ':::options\n<b>x</b> | <i>$1</i>\n:::' })).not.toMatch(/<b>x|<i>\$1/)
    })
})

describe('sources list', () => {
    const h = renderHtml({ title: 'T', body })
    it('links safe urls with host and checked date', () => {
        expect(h).toContain('href="https://www.lakeside.example/rates"')
        expect(h).toContain('lakeside.example · checked Oct 8')
    })
    it('never links unsafe urls', () => {
        expect(h).not.toMatch(/href="javascript/i)
        expect(h).toContain('Cancellation policy')
        expect(h).toContain('checked Oct 9')
    })
    it('flattens for pdf', () => {
        const flat = flattenBlocks(body)
        expect(flat).toContain('- Lakeside Lodge - $1,380 - Best rate, lake view (catch: Two-night minimum)')
        expect(flat).toContain('- Lodge rate, https://www.lakeside.example/rates, checked Oct 8')
        expect(flat).not.toContain(':::')
    })
})
