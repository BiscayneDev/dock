/**
 * Offer only the tools a turn can plausibly use. Every call used to carry all
 * ~35 tool definitions (~3-4k tokens), which slows the model and invites the
 * wrong tool. Groups are chosen from the current message plus recent context
 * (so "yes" and "send it" keep the tools the thread was about). Anything
 * withheld stays one call away: the model can ask for a group with
 * `more_tools`, and the group is offered from the next iteration.
 *
 * Gating changes only which definitions are sent. Confirmation gates,
 * egress guards and account checks live inside the tools and still apply.
 * Unknown tools are never withheld.
 */
import type { Tool, ToolResult } from '@/lib/llm/types'

type Group = { name: string; blurb: string; owns: RegExp; when: RegExp }

export const GROUPS: Group[] = [
    { name: 'email', blurb: 'read, search, send or reply to email', owns: /^(gmail_|email_)/, when: /\b(e-?mails?|mail|inbox|gmail|repl(y|ies)|draft|unsubscribe|thread|sender|attachments?|forward|cc|bcc)\b/i },
    { name: 'calendar', blurb: 'read the calendar or create events', owns: /^gcal_/, when: /\b(calendar|meetings?|schedule[ds]?|events?|agenda|appointments?|invites?|free|busy|today|tomorrow|tonight|this (week|morning|afternoon|weekend)|next (week|month)|flights?|trips?|brief|plans?|when|what time|resched\w*|booked)\b/i },
    { name: 'google_accounts', blurb: 'list, switch or disconnect connected Google accounts', owns: /^google_(accounts|set_primary|disconnect)$/, when: /\b(google|accounts?|connect(ed)?|disconnect|primary|sign ?in|link)\b/i },
    { name: 'wallet', blurb: 'wallet balances, on-ramp, signing', owns: /^(wallet_|paybox)/, when: /\b(wallet|balances?|usdc|crypto|paybox|on-?ramp|eth|solana|transfer|pay(ment)?|fund|deposit|withdraw|sign)\b/i },
    { name: 'x', blurb: 'X / Twitter reads and posts', owns: /^(x_|twitter_)/, when: /\b(twitter|tweets?|x\.com|x posts?|retweet|timeline)\b|@\w+/i },
    { name: 'github', blurb: 'GitHub repos, issues, PRs, notifications', owns: /^github_/, when: /\b(github|repos?|repository|issues?|pull requests?|prs?|commits?|branch|merge|notifications?)\b/i },
    { name: 'computer', blurb: 'browser, computer, workflows, recipes: act on websites, automate', owns: /^(computer_|browser_|workflow_|recipe_)/, when: /\b(browse|browser|web ?sites?|sites?|click|log ?in|fill|forms?|book|order|buy|checkout|screenshot|automate|automation|workflows?|recipes?|computer|run|scrape|download|upload)\b|https?:\/\//i },
    { name: 'invites', blurb: 'invite links and invite balance', owns: /^invite_/, when: /\b(invites?|referral|friends?|waitlist|allowance)\b/i },
    { name: 'file_revoke', blurb: 'take down a shared file or page', owns: /^revoke_file$/, when: /\b(revoke|unshare|delete (the )?(file|page|link)|take (it )?down)\b/i },
]

const MIN_TO_GATE = 12

export interface Gated {
    /** Pass to the tool loop. The more_tools tool, when present, mutates this same array. */
    active: Tool[]
    withheld: string[]
}

/** `texts`: current user message first, then recent context (prior user messages, last assistant line). */
export function gateTools(tools: Tool[], texts: string[]): Gated {
    if (tools.length <= MIN_TO_GATE) return { active: [...tools], withheld: [] }
    const haystack = texts.join('\n')
    const wanted = new Set(GROUPS.filter((g) => g.when.test(haystack)).map((g) => g.name))
    const groupOf = (t: Tool) => GROUPS.find((g) => g.owns.test(t.name))
    const active: Tool[] = []
    const held = new Map<string, Tool[]>()
    for (const t of tools) {
        const g = groupOf(t)
        if (!g || wanted.has(g.name)) active.push(t)
        else held.set(g.name, [...(held.get(g.name) ?? []), t])
    }
    if (held.size === 0) return { active, withheld: [] }
    const names = [...held.keys()]
    const more: Tool = {
        name: 'more_tools',
        description: 'Some tools are not loaded for this message. Request a group when you need it: ' +
            names.map((n) => `${n} (${GROUPS.find((g) => g.name === n)!.blurb})`).join('; ') + '. They are available on your next step.',
        inputSchema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: names } } }, required: ['groups'] },
        async execute(input: unknown): Promise<ToolResult> {
            const asked = ((input as { groups?: unknown })?.groups ?? []) as unknown
            const enabled: string[] = []
            for (const n of Array.isArray(asked) ? asked : []) {
                const tl = typeof n === 'string' ? held.get(n) : undefined
                if (!tl) continue
                active.push(...tl)
                held.delete(n as string)
                enabled.push(n as string)
            }
            return { success: true, data: { enabled, note: enabled.length ? 'Now available.' : 'Nothing new to enable.' } }
        },
    }
    active.push(more)
    return { active, withheld: names }
}
