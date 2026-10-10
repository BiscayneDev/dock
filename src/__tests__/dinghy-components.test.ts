import { describe, expect, it } from 'vitest'
import { flattenBlocks, placeLinks, renderHtml, renderPdf, splitBlocks } from '@/lib/files/render'

const body = [
    '> Pick: Lodge on the lake',
    '',
    ':::facts',
    'When: Aug 12-16',
    'Where: Lake Champlain',
    ':::',
    '',
    ':::cost',
    'Room, 4 nights: $1,200',
    'Taxes and fees: $180',
    'Total: $1,380 (taxes included)',
    ':::',
    '',
    ':::heads-up',
    'Free cancellation ends Aug 5.',
    ':::',
    '',
    ':::place',
    'Name: Lakeside Lodge',
    'Address: 1 Lake Rd, Burlington VT',
    'Phone: (802) 555-0100',
    ':::',
    '',
    '### Sat Aug 12',
    '- 10:00 Check in',
    '',
    '## Pack',
    '- [ ] Sunscreen',
    '- [x] Charger',
].join('\n')

describe('page components', () => {
    const html = renderHtml({ title: 'Trip', body })
    it('draws facts, cost, heads-up, place, checklist and day header', () => {
        expect(html).toContain('class="facts"')
        expect(html).toContain('Lake Champlain')
        expect(html).toContain('ctotal')
        expect(html).toContain('class="heads"')
        expect(html).toContain('https://maps.apple.com/?q=1%20Lake%20Rd%2C%20Burlington%20VT')
        expect(html).toContain('href="tel:8025550100"')
        expect(html).toContain('class="checklist"')
        expect(html).toContain('type="checkbox"')
        expect(html).toContain('checked')
        expect(html).toContain('<h3 class="day">')
        expect(html).not.toContain(':::')
    })
    it('flags a cost block with no total', () => {
        expect(renderHtml({ title: 'x', body: ':::cost\nRoom: $100\n:::' })).toContain('No total given')
    })
    it('escapes HTML inside blocks', () => {
        const h = renderHtml({ title: 'x', body: ':::facts\nWhen: <script>alert(1)</script>\n:::' })
        expect(h).not.toContain('<script>alert')
    })
    it('leaves unknown or unclosed blocks as text', () => {
        expect(splitBlocks(':::weird\na\n:::').every((s) => s.kind === 'md')).toBe(true)
        expect(splitBlocks(':::facts\nWhen: x').every((s) => s.kind === 'md')).toBe(true)
    })
    it('rejects bad phone numbers and flattens for pdf', () => {
        expect(placeLinks('', 'call me').tel).toBeNull()
        const flat = flattenBlocks(body)
        expect(flat).not.toContain(':::')
        expect(flat).toContain('> Heads up: Free cancellation ends Aug 5.')
        expect(flat).toContain('- Total: $1,380 (taxes included)')
    })
    it('still renders a pdf', async () => {
        const pdf = await renderPdf({ title: 'Trip', body })
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    })
})
