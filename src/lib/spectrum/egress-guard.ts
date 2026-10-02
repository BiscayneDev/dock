/**
 * Egress control for turns that already hold Gmail/Calendar data.
 *
 * Tools that carry model-written text to a third party (web search and fetch,
 * social search, browser and computer tasks) stay available, but a call is
 * rejected when its arguments copy text out of the Google results: an 8+ word
 * verbatim span, an email address, or a 6+ digit run that the Google results
 * contained. DINGHY_EGRESS_POLICY=block blocks those tools outright for the
 * rest of a tainted turn, except the sandbox and file tools; =off disables the guard.
 *
 * STRENGTH: this stops accidental or injected verbatim copying (a pasted
 * email passage, a forwarded address, a confirmation or account number). It does
 * NOT stop paraphrase, short names, places or dates, or a deliberately encoded
 * leak. It is a leak guard, not an exfiltration wall.
 */
export type EgressPolicy = 'guard' | 'block' | 'off'

export function egressPolicy(env: Record<string, string | undefined> = process.env): EgressPolicy {
  const v = (env.DINGHY_EGRESS_POLICY ?? 'guard').toLowerCase()
  return v === 'block' || v === 'off' ? v : 'guard'
}

/** Tools whose arguments leave for the open web or a third party. The guard checks these. */
export function isEgressTool(name: string): boolean {
  return /^(web_search|web_fetch|twitter_|x_search|x_read_post|x_recent_posts|x_profile|computer_browse|computer_run)$/.test(name) || /^(twitter_|x_)/.test(name)
}

/**
 * Only policy=block stops these outright. The sandbox (computer_run) and file
 * tools are NOT here: briefs, itineraries and files built from Gmail/Calendar
 * data must keep working. computer_run still gets the argument guard.
 */
export function isHardBlockTool(name: string): boolean {
  return isEgressTool(name) && name !== 'computer_run'
}

const SPAN = 8
const words = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}@.\-']+/gu, ' ').split(/\s+/).filter(Boolean)
const emails = (t: string): string[] => t.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []
const digitRuns = (t: string): string[] => t.match(/\d[\d\s-]{4,}\d/g)?.map((d) => d.replace(/\D/g, '')).filter((d) => d.length >= 6) ?? []

export interface GoogleCorpus {
  spans: Set<string>
  emails: Set<string>
  digits: Set<string>
}

export function emptyCorpus(): GoogleCorpus {
  return { spans: new Set(), emails: new Set(), digits: new Set() }
}

/** Add one Google tool result to the corpus the guard checks against. */
export function addToCorpus(c: GoogleCorpus, text: string): void {
  const w = words(text)
  for (let i = 0; i + SPAN <= w.length; i++) c.spans.add(w.slice(i, i + SPAN).join(' '))
  for (const e of emails(text)) c.emails.add(e)
  for (const d of digitRuns(text)) c.digits.add(d)
}

/** Why the arguments leak Google text, or null when they are clean. */
export function findLeak(args: string, c: GoogleCorpus): 'span' | 'email' | 'digits' | null {
  const w = words(args)
  for (let i = 0; i + SPAN <= w.length; i++) if (c.spans.has(w.slice(i, i + SPAN).join(' '))) return 'span'
  for (const e of emails(args)) if (c.emails.has(e)) return 'email'
  for (const d of digitRuns(args)) if (c.digits.has(d)) return 'digits'
  return null
}

export const EGRESS_REJECT_MESSAGE =
  'That call carried text copied from the user\'s email or calendar. Rewrite it in your own words without names, numbers or passages from their mail, and try again.'
export const EGRESS_BLOCK_MESSAGE =
  'This turn already read Google data, so web and browser tools are off until the next message. Say what you still need and ask for it separately.'
