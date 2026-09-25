/**
 * Day-1 interview (Workstream F2): never let the first day read like a form.
 *
 * The opener ("what's eating your time this week?") already fires on a
 * genuinely new chat (dinghy.ts, handler includeOpener). When its answer
 * arrives, at most TWO short follow-ups go out, spread across separate
 * turns: confirm what to call them, and one "what should your mornings
 * look like?". Whoever the person already answered is skipped; answers
 * become profile facts through the normal memory write path (storeFacts —
 * secret-guarded, deduped, embedding-backed). State lives in
 * dinghy_interviews (migration 040) so the serverless handler stays
 * stateless and the cap holds across restarts.
 */

import { createServerClient } from '@/lib/supabase/server'
import { looksSecret, resolveUserId, storeFacts } from './memory'

const STAGE_NONE = 0
const STAGE_OPENER_ASKED = 1
const STAGE_NAME_ASKED = 2
const STAGE_MORNINGS_ASKED = 3
const STAGE_DONE = 4

const NAME_INSTRUCTION =
    'Then, in the same short lowercase texting voice, end your reply with exactly this one question and nothing else new: ' +
    '"Also, what should I call you? First name works."'
const MORNINGS_INSTRUCTION =
    'Then, in the same short lowercase texting voice, end your reply with exactly this one question and nothing else new: ' +
    '"One more, then I\'m done with questions: what should your mornings look like?"'

const NAME_TOLD = /(?:my name(?:'s| is)|call me|i'?m|this is|it'?s)\s+[a-z]/i
const MORNINGS_TOLD = /\b(mornings?|wake|waking|rise|rising|start my day|early riser|alarm)\b/i

const NAME_STOP = new Set([
    'not', 'sure', 'good', 'fine', 'just', 'really', 'here', 'sorry', 'great',
    'busy', 'tired', 'stressed', 'working', 'trying', 'going', 'doing', 'back',
    'new', 'from', 'into', 'out', 'up', 'down', 'so', 'very', 'still', 'again',
])

/** "call me Sam" / "my name's Halsey" / "i'm Pia" → the name, else null. */
export function extractName(text: string): string | null {
    const m = text.match(/(?:my name(?:'s| is)|call me|i'?m|this is|it'?s)\s+([a-z][a-z'-]{1,24})/i)
    if (!m) return null
    const name = m[1].replace(/^[-']+|[-']+$/g, '')
    if (!name || NAME_STOP.has(name.toLowerCase())) return null
    return name[0].toUpperCase() + name.slice(1)
}

/** A one-word "hi" doesn't count as answering the opener. */
export function isSubstantive(text: string): boolean {
    const t = text.trim()
    if (t.split(/\s+/).length < 2) return false
    return !/^(?:hi|hey|hello|yo|sup|ok|okay|cool|nice|great|thanks|👍)\b[!. ]*$/i.test(t)
}

async function getStage(chatGuid: string): Promise<number> {
    const { data, error } = await createServerClient()
        .from('dinghy_interviews')
        .select('stage')
        .eq('chat_guid', chatGuid)
        .maybeSingle()
    if (error) throw new Error(`dinghy_interviews read failed: ${error.message}`)
    const stage = (data as { stage?: number } | null)?.stage
    return typeof stage === 'number' ? stage : STAGE_NONE
}

async function setStage(chatGuid: string, stage: number): Promise<void> {
    const { error } = await createServerClient()
        .from('dinghy_interviews')
        .upsert({ chat_guid: chatGuid, stage, updated_at: new Date().toISOString() })
    if (error) throw new Error(`dinghy_interviews write failed: ${error.message}`)
}

/**
 * The opener question went out in this turn's reply: remember that the
 * interview is live. Never resets an existing row.
 */
export async function markOpenerAsked(chatGuid: string): Promise<void> {
    const { error } = await createServerClient()
        .from('dinghy_interviews')
        .upsert({ chat_guid: chatGuid, stage: STAGE_OPENER_ASKED }, { onConflict: 'chat_guid', ignoreDuplicates: true })
    if (error) throw new Error(`dinghy_interviews opener mark failed: ${error.message}`)
}

async function storeAnswer(chatGuid: string, content: string, type: 'person' | 'preference'): Promise<void> {
    const trimmed = content.trim().slice(0, 300)
    if (!trimmed || looksSecret(trimmed)) return
    const userId = await resolveUserId(chatGuid).catch(() => null)
    await storeFacts(chatGuid, userId, 'imessage', [{ content: trimmed, type }])
}

/**
 * Called per inbound message (history non-empty). Returns the system-prompt
 * line that makes THIS turn's reply end with the next interview question,
 * or null for "no question this turn". Advances state and files answers as
 * profile facts. Total questions ever: 2 (the opener is separate).
 */
export async function interviewDirective(chatGuid: string, firstUserText: string, answerText: string, knownFirstName?: string | null): Promise<string | null> {
    try {
        const stage = await getStage(chatGuid)
        if (stage === STAGE_OPENER_ASKED) {
            if (!isSubstantive(answerText)) return null
            const nameKnown = Boolean(knownFirstName) || NAME_TOLD.test(firstUserText) || NAME_TOLD.test(answerText)
            const morningsKnown = MORNINGS_TOLD.test(firstUserText) || MORNINGS_TOLD.test(answerText)
            if (nameKnown && morningsKnown) {
                await setStage(chatGuid, STAGE_DONE)
                return null
            }
            if (nameKnown) {
                await setStage(chatGuid, STAGE_MORNINGS_ASKED)
                return MORNINGS_INSTRUCTION
            }
            await setStage(chatGuid, STAGE_NAME_ASKED)
            return NAME_INSTRUCTION
        }
        if (stage === STAGE_NAME_ASKED) {
            const name = extractName(answerText)
            if (name) await storeAnswer(chatGuid, `goes by ${name}`, 'person')
            const morningsKnown = MORNINGS_TOLD.test(firstUserText) || MORNINGS_TOLD.test(answerText)
            if (morningsKnown) {
                await setStage(chatGuid, STAGE_DONE)
                return null
            }
            await setStage(chatGuid, STAGE_MORNINGS_ASKED)
            return MORNINGS_INSTRUCTION
        }
        if (stage === STAGE_MORNINGS_ASKED) {
            if (isSubstantive(answerText)) await storeAnswer(chatGuid, `mornings should look like: ${answerText}`, 'preference')
            await setStage(chatGuid, STAGE_DONE)
            return null
        }
        return null
    } catch (err) {
        // The interview must never break a reply: any state failure just
        // ends it (a skipped question is the failure mode, not an error).
        console.error('interview step failed:', err instanceof Error ? err.message : String(err))
        return null
    }
}
