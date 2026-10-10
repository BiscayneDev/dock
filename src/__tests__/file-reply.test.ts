import { describe, expect, it } from 'vitest'
import { needsFileRepair, fileReply } from '@/lib/files/reply'

describe('current-turn file delivery', () => {
    it('repairs a fabricated new document announcement using an old link', () => {
        const reply = "I've compiled a document containing research on both vehicles. Here is the link: https://old-page-test.here.now/"
        expect(needsFileRepair(reply)).toBe(true)
        expect(fileReply(reply, 0)).not.toContain('here.now')
        expect(fileReply(reply, 1)).toBe('Here you go.')
    })
    it('does not ask the user to reply before an already queued file goes out', () => {
        expect(fileReply("I've compiled research into a document. The link will be sent after your reply!", 1)).toBe('Here you go.')
    })
    it('keeps a substantive verdict, not a delivery promise', () => {
        expect(fileReply('Choose the Bronco if you need the car this year.', 1)).toBe('Choose the Bronco if you need the car this year.')
    })
    it('does not interfere with a requested previous-file link or ordinary research answer', () => {
        expect(needsFileRepair('Your earlier Singapore page: https://old-page-test.here.now/')).toBe(false)
        expect(needsFileRepair('The Scout is not available yet.')).toBe(false)
        expect(needsFileRepair('I compiled research from these sources.')).toBe(false)
    })
    it('keeps marker repair and blocks unsupported updated-file claims', () => {
        expect(needsFileRepair('[sent file: cars.pdf]')).toBe(true)
        expect(fileReply('I updated the comparison document.', 0)).not.toContain('updated')
    })
})
