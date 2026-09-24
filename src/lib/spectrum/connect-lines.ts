import { googleAccountsOf } from '@/lib/integrations/google-accounts'
import { wantsAnotherGoogle, wantsGoogle } from '@/lib/spectrum/dinghy'

/** "connect my gmail" / "connect my other gmail": the whole request was the connect. */
export function isConnectRequest(text: string): boolean {
    if (wantsAnotherGoogle(text)) return true
    return /\b(connect|link|hook up|set up|add)\b/i.test(text) && wantsGoogle(text) && text.trim().split(/\s+/).length <= 10
}

/** Always name the account(s), and say so when an "add another" re-connected the same one. */
export function googleConnectedLine(ctx: Parameters<typeof googleAccountsOf>[0] | null, wantedAnother = false): string {
    const accounts = ctx ? googleAccountsOf(ctx) : []
    if (accounts.length === 0) return "you're connected — gmail + calendar are in ✓"
    if (accounts.length === 1) {
        if (wantedAnother) {
            return `that connected ${accounts[0].email} again - the account you already had, so i still see just one. to add your other gmail, say "connect my other gmail" and tap that account on google's screen.`
        }
        return `you're connected — gmail + calendar for ${accounts[0].email} ✓`
    }
    return `connected ✓ i can see gmail + calendar for ${accounts.map((a) => a.email).join(' and ')} now (${accounts[0].email} is primary)`
}
