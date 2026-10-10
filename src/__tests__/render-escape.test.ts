import { describe, expect, it } from 'vitest'
import { renderHtml, safeHref } from '@/lib/files/render'

const html = (body: string) => renderHtml({ title: 'T', body })

describe('untrusted markdown on shared pages', () => {
    it('shows raw html as text in every position', () => {
        const h = html('Hi <script>alert(1)</script>\n\n- item <img src=x onerror=alert(1)>\n\n> Pick: <b onclick=x>A</b>\n\n| a | b |\n| - | - |\n| <iframe src=//e.co></iframe> | 2 |\n\n### <u>day</u>')
        expect(h).not.toMatch(/<script>alert|<img src=x|<b onclick|<iframe|<u>day/)
        expect(h).toContain('&lt;script&gt;')
    })
    it('keeps javascript: and data: links off the page', () => {
        const h = html('[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c]( JaVa\tScript:alert(1))')
        expect(h).not.toMatch(/href="\s*(javascript|data)/i)
        expect(h).not.toMatch(/javascript:alert/i)
        expect(h).toContain('<p>a b ')
    })
    it('still allows normal links and drops remote images', () => {
        const h = html('[ok](https://example.com/x?a=1&b=2) [m](mailto:a@b.co) ![track](https://evil.example/p.gif)')
        expect(h).toContain('href="https://example.com/x?a=1&amp;b=2"')
        expect(h).toContain('href="mailto:a@b.co"')
        expect(h).not.toContain('evil.example/p.gif')
    })
    it('checks schemes', () => {
        expect(safeHref('https://a.co')).toBe(true)
        expect(safeHref('sms:+15551234567?&body=Hi')).toBe(true)
        expect(safeHref('  javascript:alert(1)')).toBe(false)
        expect(safeHref('vbscript:x')).toBe(false)
    })
    it('does not change normal formatting', () => {
        const h = html('**bold** and *it* and `code`\n\n- 9:00 Coffee')
        expect(h).toContain('<strong>bold</strong>')
        expect(h).toContain('<code>code</code>')
        expect(h).toContain('class="row"')
    })
})
