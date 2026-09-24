/**
 * Task-aware model routing through Shipyard (Halsey, Sep 24: "Dinghy is
 * supposed to run on the right model for the task being asked via shipyard").
 *
 * Dinghy sends model "auto" and lets Shipyard's Jev judge each request's tier,
 * then pick the cheapest capable model in it. On top, a cheap intent check on
 * the user's message (no model call) sets a floor or cap for the whole turn:
 *  - research, news, "this week", comparisons, multi-step work, corrections
 *    -> at least frontier (the strong models)
 *  - quick acks, thanks, greetings -> capped at economy
 *  - everything else -> Jev decides
 * Traffic stays on Hopscotch (Halsey, Sep 22: "We should be using it in dinghy").
 *
 * DINGHY_MODEL_ROUTING=off falls back to the pinned SHIPYARD_MODEL.
 * DINGHY_PROVIDERS overrides the candidate allowlist (comma-separated).
 */

export type Tier = 'economy' | 'standard' | 'frontier'

export interface RoutingPrefs {
    providers?: string[]
    min_tier?: Tier
    max_tier?: Tier
}

export type TurnKind = 'research' | 'casual' | 'default'

export function routingEnabled(): boolean {
    return (process.env.DINGHY_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off'
}

function providers(): string[] {
    const raw = process.env.DINGHY_PROVIDERS ?? 'hopscotch'
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

const RESEARCH = new RegExp(
    [
        String.raw`\b(this|last|past|next) (week|month|year|quarter)\b`,
        String.raw`\b(today|tonight|yesterday|recent(ly)?|latest|newest|lately|right now|currently|so far)\b`,
        String.raw`\b(news|launch(es|ed)?|announce(d|ment|ments)?|release[sd]?|funding|raised|earnings|price of|market|trending|hottest|biggest|top \d+)\b`,
        String.raw`\b(research|look (it |this |that )?up|find (me |out)?|search|dig|compare|comparison|vs\.?|versus|pros and cons|which is better|best \w+ for|recommend|analy[sz]e|summari[sz]e|explain why|breakdown|deep dive)\b`,
        String.raw`\b(plan|itinerary|draft|write (me |up )?a|put together|figure out|work out|step by step)\b`,
        String.raw`\b(verify|fact.?check|source[sd]?|cite|citation|prove|evidence)\b`,
        String.raw`\b(wrong|false|incorrect|not true|that's not|thats not|didn't|didnt|you lied|lie|hallucinat\w*|made (that|it) up|failing|try again)\b`,
    ].join('|'),
    'i'
)

const CASUAL = /^(hi|hey|hello|yo|sup|gm|gn|good (morning|night|evening)|thanks?( you)?|thx|ty|ok(ay)?|k|cool|nice|great|perfect|got it|sounds good|lol|haha+|👍|🙏|❤️|yes|yep|yeah|no|nope|sure)[\s!.?]*$/i

/** Classify the user's message for routing. Pure and cheap: runs on every turn. */
export function classifyTurn(text: string): TurnKind {
    const t = (text ?? '').trim()
    if (!t) return 'default'
    if (CASUAL.test(t)) return 'casual'
    if (RESEARCH.test(t) || t.length > 280) return 'research'
    return 'default'
}

/** Routing prefs for this turn, or undefined when routing is off (pinned model). */
export function routingFor(text: string): RoutingPrefs | undefined {
    if (!routingEnabled()) return undefined
    const kind = classifyTurn(text)
    const base: RoutingPrefs = { providers: providers() }
    if (kind === 'research') return { ...base, min_tier: 'frontier' }
    if (kind === 'casual') return { ...base, max_tier: 'economy' }
    return base
}

/** Request model + body extension for a gateway call. */
export function modelFields(pinned: string, routing: RoutingPrefs | undefined): { model: string; shipyard?: RoutingPrefs } {
    return routing ? { model: 'auto', shipyard: routing } : { model: pinned }
}
