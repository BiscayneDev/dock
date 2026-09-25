import { describe, it, expect, afterEach } from 'vitest'
import { routingFor, modelFields } from '@/lib/spectrum/routing'

afterEach(() => {
    delete process.env.DINGHY_MODEL_ROUTING
    delete process.env.DINGHY_PROVIDERS
})

describe('routingFor', () => {
    it('sends only the Hopscotch allowlist - Jev picks the tier', () => {
        expect(routingFor()).toEqual({ providers: ['hopscotch'] })
    })
    it('can be switched off or pointed elsewhere', () => {
        process.env.DINGHY_PROVIDERS = 'hopscotch, anthropic'
        expect(routingFor()?.providers).toEqual(['hopscotch', 'anthropic'])
        process.env.DINGHY_MODEL_ROUTING = 'off'
        expect(routingFor()).toBeUndefined()
    })
    it('builds the request fields', () => {
        expect(modelFields('pinned', undefined)).toEqual({ model: 'pinned' })
        expect(modelFields('pinned', { providers: ['hopscotch'] })).toEqual({ model: 'auto', shipyard: { providers: ['hopscotch'] } })
    })
})
