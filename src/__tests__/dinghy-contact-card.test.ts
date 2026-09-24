import { describe, expect, it } from 'vitest'
import { resolveContents, toVCard } from 'spectrum-ts'
import { dinghyContactCard, DINGHY_PHONE } from '@/lib/spectrum/contact-card'

describe('dinghyContactCard', () => {
    it('builds a Dinghy vCard with name, number and logo', async () => {
        const [content] = await resolveContents([dinghyContactCard()])
        expect(content.type).toBe('contact')
        const vcf = await toVCard(content as Parameters<typeof toVCard>[0])
        expect(vcf).toContain('FN:Dinghy')
        expect(vcf.replace(/\D/g, '')).toContain(DINGHY_PHONE.replace(/\D/g, ''))
        expect(vcf).toMatch(/PHOTO/)
        expect(vcf).not.toMatch(/Spectrum/i)
    })
    it("carries the person's own line when given", async () => {
        const [content] = await resolveContents([dinghyContactCard('+16286293507')])
        const vcf = await toVCard(content as Parameters<typeof toVCard>[0])
        expect(vcf.replace(/\D/g, '')).toContain('16286293507')
        expect(vcf.replace(/\D/g, '')).not.toContain('16282647754')
    })
})
