import { describe, expect, it } from 'vitest'
import { renderHtml } from '@/lib/files/render'

describe('page design layer', () => {
    const h = renderHtml({ title: 'T', body: '## A\n\ntext' })
    it('supports dark mode and tells the browser', () => {
        expect(h).toContain('prefers-color-scheme:dark')
        expect(h).toContain('name="color-scheme" content="light dark"')
    })
    it('turns motion off for people who ask', () => {
        expect(h).toContain('prefers-reduced-motion:reduce')
    })
    it('adds no scripts and no remote assets', () => {
        expect(h).not.toMatch(/<script|<link |url\(http|src="http/i)
    })
})
