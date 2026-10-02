/**
 * Site policy for logged-in browser sessions.
 *
 * - normalizeSite: turn what a user types ("https://www.GitHub.com/x") into a host.
 * - isDenied: sites Dinghy refuses to hold a session for in v1 (money, identity,
 *   mail and password stores). Matches the host and every subdomain.
 * - filterCookiesToSite: keep only cookies that belong to the connected site.
 *   The user drives a real browser during login, so they could visit anything;
 *   whatever is not the connected site is dropped before storage.
 */

export type DenyReason = 'financial' | 'identity' | 'passwords' | 'payments' | 'mail' | 'commerce' | 'social' | 'work' | 'government'

const group = (reason: DenyReason, suffixes: string[]) => suffixes.map((suffix) => ({ suffix, reason }))

/**
 * Host suffixes (the host itself and every subdomain). A session cookie on a
 * parent domain (.google.com) is the whole account, so identity, mail and
 * commerce providers are denied at the registrable domain, not per subdomain.
 */
const DENYLIST: Array<{ suffix: string; reason: DenyReason }> = [
  ...group('financial', [
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com',
    'usbank.com', 'pnc.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'robinhood.com',
    'americanexpress.com', 'amex.com', 'discover.com', 'ally.com', 'sofi.com', 'chime.com', 'mercury.com',
    'revolut.com', 'wise.com', 'hsbc.com', 'barclays.co.uk', 'tdbank.com', 'td.com', 'etrade.com',
    'interactivebrokers.com', 'merrilledge.com', 'tdameritrade.com', 'webull.com', 'public.com',
    'tastytrade.com', 'tradestation.com', 'stash.com', 'acorns.com', 'betterment.com', 'wealthfront.com',
    'navyfederal.org', 'usaa.com', 'synchrony.com', 'regions.com', 'truist.com', 'citizensbank.com',
    'keybank.com', 'huntington.com', 'fifththird.com', 'santander.com', 'monzo.com', 'n26.com',
    'plaid.com', 'mint.com', 'creditkarma.com', 'experian.com', 'equifax.com', 'transunion.com',
    'quickbooks.com', 'intuit.com', 'turbotax.com', 'hrblock.com', 'freetaxusa.com',
    'gusto.com', 'adp.com', 'paychex.com', 'rippling.com', 'justworks.com', 'deel.com', 'trinet.com',
    'bill.com', 'brex.com', 'ramp.com', 'carta.com', 'angellist.com', 'wealthsimple.com',
  ]),
  ...group('financial', [
    'coinbase.com', 'binance.com', 'binance.us', 'kraken.com', 'gemini.com', 'bitstamp.net',
    'okx.com', 'bybit.com', 'kucoin.com', 'crypto.com', 'phantom.app', 'metamask.io',
    'ledger.com', 'trezor.io', 'paybox.sh', 'uniswap.org', 'opensea.io', 'blockchain.com', 'bitfinex.com',
    'etherscan.io',
  ]),
  ...group('identity', [
    'google.com', 'googleusercontent.com', 'gmail.com', 'youtube.com', 'google.co.uk',
    'apple.com', 'icloud.com', 'me.com', 'mac.com',
    'microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'outlook.com',
    'hotmail.com', 'msn.com', 'sharepoint.com', 'azure.com', 'windows.net',
    'yahoo.com', 'aol.com', 'ymail.com', 'protonmail.com', 'fastmail.com', 'zoho.com', 'hey.com',
    'okta.com', 'auth0.com', 'onelogin.com', 'duosecurity.com', 'twilio.com', 'authy.com',
  ]),
  ...group('social', [
    'facebook.com', 'fb.com', 'messenger.com', 'instagram.com', 'meta.com', 'whatsapp.com', 'threads.net',
    'x.com', 'twitter.com', 'linkedin.com', 'tiktok.com', 'snapchat.com', 'reddit.com', 'discord.com',
    'telegram.org', 'pinterest.com', 'tumblr.com', 'bsky.app',
  ]),
  ...group('commerce', [
    'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'ebay.com', 'walmart.com', 'target.com',
    'costco.com', 'bestbuy.com', 'etsy.com', 'shopify.com', 'myshopify.com', 'aliexpress.com',
    'doordash.com', 'ubereats.com', 'uber.com', 'lyft.com', 'grubhub.com', 'instacart.com',
    'airbnb.com', 'booking.com', 'expedia.com', 'delta.com', 'united.com', 'aa.com', 'southwest.com',
    'ticketmaster.com', 'stubhub.com', 'steampowered.com', 'steamcommunity.com', 'epicgames.com',
    'playstation.com', 'xbox.com', 'nintendo.com', 'netflix.com', 'spotify.com',
  ]),
  ...group('passwords', [
    '1password.com', '1password.eu', 'lastpass.com', 'bitwarden.com', 'dashlane.com', 'keepersecurity.com',
    'proton.me', 'nordpass.com', 'roboform.com',
  ]),
  ...group('payments', [
    'paypal.com', 'paypal.me', 'venmo.com', 'cash.app', 'stripe.com', 'zellepay.com', 'link.com',
    'squareup.com', 'square.com', 'wise.com', 'payoneer.com', 'braintreegateway.com', 'adyen.com',
  ]),
  // cloud consoles and code hosts where a session can mint credentials or spend money
  ...group('work', [
    'aws.amazon.com', 'amazonaws.com', 'console.cloud.google.com', 'cloud.google.com', 'digitalocean.com',
    'vercel.com', 'cloudflare.com', 'heroku.com', 'supabase.com', 'namecheap.com', 'godaddy.com',
    'slack.com', 'zoom.us', 'dropbox.com', 'box.com',
  ]),
  ...group('government', ['irs.gov', 'ssa.gov', 'login.gov', 'id.me', 'healthcare.gov', 'usps.com', 'dmv.org']),
]

/** Whole TLDs where a login is almost always government or military identity. */
const DENIED_TLDS: Array<{ tld: string; reason: DenyReason }> = [
  { tld: 'gov', reason: 'government' },
  { tld: 'mil', reason: 'government' },
]

/**
 * Host labels that mark a login page for money or payroll no matter whose
 * brand it is (e.g. "firstbank.example", "acme-payroll.io"). Matches whole
 * hyphen- or dot-separated words so "bankless.co" is not caught by "bank".
 */
const DENIED_WORDS: Array<{ re: RegExp; reason: DenyReason }> = [
  { re: /(^|[.-])([a-z0-9]*bank|[a-z0-9]*banking|creditunion|cu|fcu|payroll|brokerage|wealth|mortgage|loans?|insurance|tax|taxes|wallet|exchange)([.-]|$)/, reason: 'financial' },
  { re: /(^|[.-])(login|signin|sso|accounts?|auth|id|idp|passport|vault)\.[a-z0-9-]+\.[a-z.]+$/, reason: 'identity' },
]

/** Two-label public suffixes we know about, so "x.co.uk" is not treated as a TLD cookie. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br',
  'com.mx', 'co.in', 'co.za', 'com.sg', 'com.hk', 'com.tr', 'com.cn',
])

/** Host for a user-typed site, or null if it isn't a plausible public hostname. */
export function normalizeSite(input: string): string | null {
  let raw = input.trim().toLowerCase()
  if (!raw || raw.length > 253) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  let host = url.hostname.replace(/\.$/, '')
  if (host.startsWith('www.')) host = host.slice(4)
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null
  if (/^\d+(\.\d+){3}$/.test(host)) return null // raw IPs
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null
  if (TWO_LABEL_SUFFIXES.has(host)) return null
  return host
}

function hostUnder(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** Why this host is refused, or null if allowed. */
export function isDenied(host: string): DenyReason | null {
  const h = host.toLowerCase()
  for (const d of DENYLIST) if (hostUnder(h, d.suffix)) return d.reason
  const tld = h.split('.').pop() ?? ''
  for (const t of DENIED_TLDS) if (tld === t.tld) return t.reason
  for (const w of DENIED_WORDS) if (w.re.test(h)) return w.reason
  return null
}

/**
 * v1 connect tiers. "allowed" sites are low-stakes (a session leak does not
 * move money or take over an identity) and connect with one tap. Everything
 * else that is not denied is "confirm": the user must explicitly acknowledge
 * that Dinghy will hold a session for a site it has not vetted. Denied sites
 * never connect.
 */
const ALLOWED_SITES = [
  'github.com', 'gitlab.com', 'linear.app', 'notion.so', 'readwise.io', 'goodreads.com', 'letterboxd.com',
  'news.ycombinator.com', 'medium.com', 'substack.com', 'nytimes.com', 'wsj.com', 'economist.com', 'ft.com',
  'bloomberg.com', 'theatlantic.com', 'newyorker.com', 'washingtonpost.com', 'stratechery.com',
  'strava.com', 'trello.com', 'asana.com', 'airtable.com', 'figma.com', 'canva.com',
]

export type SiteTier = 'allowed' | 'confirm' | 'denied'

export function siteTier(host: string): SiteTier {
  if (isDenied(host)) return 'denied'
  const h = host.toLowerCase()
  return ALLOWED_SITES.some((s) => hostUnder(h, s)) ? 'allowed' : 'confirm'
}

export interface BrowserCookie {
  name: string
  value: string
  domain: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export interface StorageState {
  cookies: BrowserCookie[]
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
}

/** Does a cookie scoped to cookieDomain belong to the connected site? */
export function cookieBelongsToSite(cookieDomain: string, site: string): boolean {
  const d = cookieDomain.toLowerCase().replace(/^\./, '')
  if (!d || d.split('.').length < 2) return false
  if (TWO_LABEL_SUFFIXES.has(d)) return false
  return d === site || site.endsWith(`.${d}`) || d.endsWith(`.${site}`)
}

/**
 * Reduce a captured storage state to the connected site: cookies on that
 * site only, localStorage for that site's origins only. Also refuses to keep
 * anything for denylisted hosts even if they sit under the site.
 */
export function filterStateToSite(state: StorageState, site: string): { state: StorageState; dropped: number } {
  const cookies = (state.cookies ?? []).filter(
    (c) => typeof c.domain === 'string' && cookieBelongsToSite(c.domain, site) && !isDenied(c.domain.replace(/^\./, ''))
  )
  const origins = (state.origins ?? []).filter((o) => {
    try {
      const h = new URL(o.origin).hostname.replace(/^www\./, '')
      return (h === site || h.endsWith(`.${site}`) || site.endsWith(`.${h}`)) && !isDenied(h)
    } catch {
      return false
    }
  })
  const dropped = (state.cookies?.length ?? 0) - cookies.length
  return { state: { cookies, origins }, dropped }
}

/**
 * Extra hosts a site genuinely needs (CDN or asset hosts, deeper subdomains).
 * Empty on purpose: "*.site" matches one label at E2B and the browser guard
 * allows the site and its subdomains, so add an entry here, by exact host or
 * "*.parent", only when a connected site breaks without it. Wildcards in
 * extras are kept; everything else is normalized as a site.
 */
export const SITE_EXTRA_HOSTS: Record<string, string[]> = {}

/** Egress allowlist for the site: its host, one-label subdomains, and any explicitly listed extras. */
export function egressHostsFor(site: string, extra: string[] = SITE_EXTRA_HOSTS[site] ?? []): string[] {
  const hosts = new Set<string>([site, `*.${site}`])
  for (const e of extra) {
    if (/^\*\.[a-z0-9.-]+$/.test(e) && normalizeSite(e.slice(2))) hosts.add(e)
    else if (normalizeSite(e)) hosts.add(normalizeSite(e) as string)
  }
  return [...hosts]
}
