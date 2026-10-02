import { googleAccountsOf } from '@/lib/integrations/google-accounts'
import { wantsAnotherGoogle, wantsGoogle } from '@/lib/spectrum/dinghy'

/** "connect my gmail" / "connect my other gmail": the whole request was the connect. */
export function isConnectRequest(text: string): boolean {
    if (wantsAnotherGoogle(text)) return true
    return /\b(connect|link|hook up|set up|add)\b/i.test(text) && wantsGoogle(text) && text.trim().split(/\s+/).length <= 10
}

/**
 * A reconnect or "where's the link" ask while Google already looks connected
 * (stale or wrong account). Any wording with a Google noun plus a connect verb or
 * a missing-link complaint. Task-bearing asks ("summarize my inbox") do not match.
 */
export function isGoogleReconnectIntent(text: string): boolean {
    if (!wantsGoogle(text) && !/\bgoogle\b/i.test(text)) return false
    const verb = /\b(re-?connect(ing)?|re-?link|re-?authori[sz]e|re-?auth|re-?login|re-?sign|connect|link (my|it|up)|hook up|set up|sign in|log in|fix|switch)\b/i
    const noLink = /\b(not seeing|don'?t see|didn'?t (get|see|receive)|no|where'?s|where is|send( me)?|resend)\b.{0,25}\blink\b/i
    return noLink.test(text) || (verb.test(text) && text.trim().split(/\s+/).length <= 25)
}

/** Always name the account(s), and say so when an "add another" re-connected the same one. */
export function googleConnectedLine(ctx: Parameters<typeof googleAccountsOf>[0] | null, wantedAnother = false): string {
    const accounts = ctx ? googleAccountsOf(ctx) : []
    if (accounts.length === 0) return "You're connected. Gmail and Calendar are in."
    if (accounts.length === 1) {
        if (wantedAnother) {
            return `That connected ${accounts[0].email} again - the account you already had, so I still see just one. To add your other Gmail, say "connect my other gmail" and tap that account on Google's screen.`
        }
        return `You're connected. Gmail and Calendar are in for ${accounts[0].email}.`
    }
    return `connected ✓ i can see gmail + calendar for ${accounts.map((a) => a.email).join(' and ')} now (${accounts[0].email} is primary)`
}

/**
 * The early Google ask: what it unlocks, one tap, and what is true about
 * access. Disconnecting deletes the stored Google tokens (disconnectGoogleAccount),
 * so Dinghy stops reading. It does not claim anything is erased.
 */
export const GOOGLE_CONNECT_ASK =
    "Next, connect Google - it's the first step. For my first look I read headers only, never message bodies: who is in your inbox and what is on your calendar. I'll take a first look right away and learn who matters so I can brief you every morning at 8 your time. One tap, you approve it on Google, and you can disconnect any time and I stop reading:"

/** The one question that starts real work. Replaces the tip list. */
export const FIRST_USE_QUESTION = "Send me one real thing you'd like off your plate. A reply you owe, a plan to sort, something to look up. I'll take it from there."

/** Kept as aliases so callers do not change; the tip list is gone. */
export const FIRST_USE_SUGGESTIONS_NO_GOOGLE = FIRST_USE_QUESTION
export const FIRST_USE_SUGGESTIONS = FIRST_USE_QUESTION

/**
 * Whether the welcome bundle (contact card, tips, Google link) goes out after
 * this reply. It rides on the first delivered answer for a member, whatever the
 * answer says, so it never waits for a second message. Only a short error-style
 * reply or a pending draft holds it back. Returns a reason when skipped so the
 * handler can log why.
 */
export function firstReplyBundleDecision(input: { answerDelivered: boolean; reply: string; hasProposal: boolean; role: string | null }): { send: true } | { send: false; reason: string } {
  if (input.role !== 'member') return { send: false, reason: 'role' }
  if (!input.answerDelivered) return { send: false, reason: 'answer_not_delivered' }
  if (!input.reply.trim()) return { send: false, reason: 'empty_reply' }
  if (input.hasProposal) return { send: false, reason: 'draft_pending' }
  const r = input.reply.trim()
  if (r.length < 120 && /^(?:I couldn't|Couldn't|Sorry|Something went wrong)/i.test(r)) return { send: false, reason: 'error_reply' }
  return { send: true }
}
