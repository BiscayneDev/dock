import { describe, it, expect, afterEach } from 'vitest'
import { classifyTurn, routingFor, modelFields } from '@/lib/spectrum/routing'

afterEach(() => {
    delete process.env.DINGHY_MODEL_ROUTING
    delete process.env.DINGHY_PROVIDERS
})

describe('classifyTurn', () => {
    it('sends research, news and corrections up', () => {
        for (const t of [
            'What were the hottest AI product launches this week?',
            'compare the Ledger and Trezor wallets',
            'find me a flight to Miami friday',
            '? MoonPay didn’t launch an ai agent this week',
            "That's wrong",
            'what is the latest on ETH ETFs',
        ]) expect(classifyTurn(t), t).toBe('research')
    })
    it('keeps quick acks cheap', () => {
        for (const t of ['hey', 'thanks!', 'ok', 'sounds good', '👍']) expect(classifyTurn(t), t).toBe('casual')
    })
    it('leaves ordinary asks to Shipyard', () => {
        for (const t of ["what's on my calendar tomorrow", 'remind me to call mom at 5']) expect(classifyTurn(t), t).toBe('default')
    })
})

describe('routingFor', () => {
    it('routes on Hopscotch with a tier floor or cap', () => {
        expect(routingFor('hottest launches this week')).toEqual({ providers: ['hopscotch'], min_tier: 'frontier' })
        expect(routingFor('thanks')).toEqual({ providers: ['hopscotch'], max_tier: 'economy' })
        expect(routingFor('remind me at 5')).toEqual({ providers: ['hopscotch'] })
    })
    it('can be switched off or pointed elsewhere', () => {
        process.env.DINGHY_PROVIDERS = 'hopscotch, anthropic'
        expect(routingFor('hi')?.providers).toEqual(['hopscotch', 'anthropic'])
        process.env.DINGHY_MODEL_ROUTING = 'off'
        expect(routingFor('hi')).toBeUndefined()
    })
    it('builds the request fields', () => {
        expect(modelFields('pinned', undefined)).toEqual({ model: 'pinned' })
        expect(modelFields('pinned', { providers: ['hopscotch'] })).toEqual({ model: 'auto', shipyard: { providers: ['hopscotch'] } })
    })
})
