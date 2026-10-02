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

export type DenyReason = 'financial' | 'identity' | 'passwords' | 'payments'

/** Host suffixes (host itself and any subdomain). Deliberately conservative. */
const DENYLIST: Array<{ suffix: string; reason: DenyReason }> = [
  // banks / brokers / card issuers
  ...[
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com',
    'usbank.com', 'pnc.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'robinhood.com',
    'americanexpress.com', 'discover.com', 'ally.com', 'sofi.com', 'chime.com', 'mercury.com',
    'revolut.com', 'wise.com', 'hsbc.com', 'barclays.co.uk', 'tdbank.com', 'etrade.com',
    'interactivebrokers.com', 'merrilledge.com',
  ].map((suffix) => ({ suffix, reason: 'financial' as const })),
  // exchanges and wallets
  ...[
    'coinbase.com', 'binance.com', 'binance.us', 'kraken.com', 'gemini.com', 'bitstamp.net',
    'okx.com', 'bybit.com', 'kucoin.com', 'crypto.com', 'phantom.app', 'metamask.io',
    'ledger.com', 'trezor.io', 'paybox.sh',
  ].map((suffix) => ({ suffix, reason: 'financial' as const })),
  // account / identity providers
  ...[
    'accounts.google.com', 'myaccount.google.com', 'appleid.apple.com', 'idmsa.apple.com',
    'login.live.com', 'account.microsoft.com', 'login.microsoftonline.com', 'okta.com',
    'auth0.com',
  ].map((suffix) => ({ suffix, reason: 'identity' as const })),
  // password managers
  ...['1password.com', 'lastpass.com', 'bitwarden.com', 'dashlane.com', 'keepersecurity.com', 'proton.me']
    .map((suffix) => ({ suffix, reason: 'passwords' as const })),
  // payment processors
  ...['paypal.com', 'venmo.com', 'cash.app', 'stripe.com', 'zellepay.com', 'link.com']
    .map((suffix) => ({ suffix, reason: 'payments' as const })),
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
  return null
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

/** Egress allowlist for the site: its host and subdomains. Extra hosts are opt-in per site. */
export function egressHostsFor(site: string, extra: string[] = []): string[] {
  const hosts = new Set<string>([site, `*.${site}`])
  for (const e of extra) if (normalizeSite(e)) hosts.add(normalizeSite(e) as string)
  return [...hosts]
}
