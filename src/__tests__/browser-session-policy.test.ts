import { describe, it, expect } from 'vitest'
import { normalizeSite, isDenied, siteTier, cookieBelongsToSite, filterStateToSite, egressHostsFor } from '@/lib/browser-sessions/policy'

describe('normalizeSite', () => {
  it('reduces typed input to a host', () => {
    expect(normalizeSite('https://www.GitHub.com/settings')).toBe('github.com')
    expect(normalizeSite('github.com')).toBe('github.com')
    expect(normalizeSite(' app.linear.app ')).toBe('app.linear.app')
  })
  it('rejects non-sites', () => {
    for (const bad of ['', 'localhost', 'http://127.0.0.1', 'http://10.0.0.1', 'ftp://x.com', 'https://u:p@x.com', 'foo', 'co.uk', 'x.internal', 'javascript:alert(1)']) {
      expect(normalizeSite(bad), bad).toBeNull()
    }
  })
})

describe('isDenied', () => {
  it('blocks money, identity and password sites and their subdomains', () => {
    expect(isDenied('chase.com')).toBe('financial')
    expect(isDenied('secure.chase.com')).toBe('financial')
    expect(isDenied('coinbase.com')).toBe('financial')
    expect(isDenied('accounts.google.com')).toBe('identity')
    expect(isDenied('appleid.apple.com')).toBe('identity')
    expect(isDenied('vault.bitwarden.com')).toBe('passwords')
    expect(isDenied('paypal.com')).toBe('payments')
  })
  it('does not block lookalikes or unrelated sites', () => {
    expect(isDenied('github.com')).toBeNull()
    expect(isDenied('notchase.com')).toBeNull()
    expect(isDenied('chase.com.evil.example')).toBeNull()
    expect(isDenied('bankless.co')).toBeNull()
    expect(isDenied('mygoogle.com')).toBeNull()
    expect(isDenied('google.com.evil.example')).toBeNull()
  })
})

describe('cookieBelongsToSite', () => {
  it('keeps the site, its parents and its subdomains', () => {
    expect(cookieBelongsToSite('github.com', 'github.com')).toBe(true)
    expect(cookieBelongsToSite('.github.com', 'github.com')).toBe(true)
    expect(cookieBelongsToSite('api.github.com', 'github.com')).toBe(true)
    expect(cookieBelongsToSite('.example.com', 'app.example.com')).toBe(true)
  })
  it('drops other sites and bare suffixes', () => {
    expect(cookieBelongsToSite('google.com', 'github.com')).toBe(false)
    expect(cookieBelongsToSite('evilgithub.com', 'github.com')).toBe(false)
    expect(cookieBelongsToSite('com', 'github.com')).toBe(false)
    expect(cookieBelongsToSite('.co.uk', 'x.co.uk')).toBe(false)
  })
})

describe('filterStateToSite', () => {
  it('keeps only the connected site and reports how many cookies it dropped', () => {
    const { state, dropped } = filterStateToSite(
      {
        cookies: [
          { name: 'a', value: '1', domain: '.github.com' },
          { name: 'b', value: '2', domain: 'accounts.google.com' },
          { name: 'c', value: '3', domain: 'tracker.example' },
        ],
        origins: [
          { origin: 'https://github.com', localStorage: [{ name: 'k', value: 'v' }] },
          { origin: 'https://mail.google.com', localStorage: [{ name: 'k', value: 'v' }] },
        ],
      },
      'github.com'
    )
    expect(state.cookies.map((c) => c.name)).toEqual(['a'])
    expect(state.origins.map((o) => o.origin)).toEqual(['https://github.com'])
    expect(dropped).toBe(2)
  })
  it('never keeps denylisted hosts even under the site', () => {
    const { state } = filterStateToSite({ cookies: [{ name: 'a', value: '1', domain: 'paypal.com' }], origins: [] }, 'paypal.com')
    expect(state.cookies).toEqual([])
  })
})

describe('egressHostsFor', () => {
  it('allows the site and its subdomains, plus normalized extras', () => {
    expect(egressHostsFor('github.com')).toEqual(['github.com', '*.github.com'])
    expect(egressHostsFor('github.com', ['https://www.githubassets.com', 'bad host'])).toEqual(['github.com', '*.github.com', 'githubassets.com'])
  })
})

describe('broadened denylist', () => {
  const denied = [
    'google.com', 'mail.google.com', 'drive.google.com', 'docs.google.com', 'youtube.com', 'gmail.com',
    'outlook.live.com', 'outlook.office.com', 'office.com', 'microsoft.com', 'login.microsoftonline.com',
    'icloud.com', 'www.icloud.com', 'apple.com', 'yahoo.com', 'mail.yahoo.com', 'facebook.com', 'm.facebook.com',
    'meta.com', 'instagram.com', 'x.com', 'twitter.com', 'linkedin.com', 'amazon.com', 'smile.amazon.com',
    'ebay.com', 'doordash.com', 'schwab.com', 'client.schwab.com', 'fidelity.com', 'netbenefits.fidelity.com',
    'gusto.com', 'adp.com', 'workforcenow.adp.com', 'turbotax.com', 'irs.gov', 'sa.www4.irs.gov', 'ssa.gov',
    'tax.ny.gov', 'army.mil', 'firstbank.example', 'my-bank.example.org', 'online.banking.example.com',
    'acme-payroll.io', 'login.example.com', 'sso.corp.example.com',
  ]
  for (const h of denied) it(`denies ${h}`, () => expect(isDenied(h), h).not.toBeNull())

  it('still allows ordinary low-stakes sites and does not over-match words', () => {
    for (const h of ['github.com', 'linear.app', 'news.ycombinator.com', 'bankless.co', 'idea.example.com', 'taxonomy.example.com', 'app.notion.so'])
      expect(isDenied(h), h).toBeNull()
  })
  it('catches lookalike subdomain tricks only when the real domain is the suffix', () => {
    expect(isDenied('google.com.evil.example')).toBeNull()
    expect(isDenied('evil.example/google.com')).toBeNull()
    expect(isDenied('x.mail.google.com')).toBe('identity')
  })
})

describe('siteTier', () => {
  it('splits denied, allowed and confirm', () => {
    expect(siteTier('mail.google.com')).toBe('denied')
    expect(siteTier('github.com')).toBe('allowed')
    expect(siteTier('gist.github.com')).toBe('allowed')
    expect(siteTier('notgithub.com')).toBe('confirm')
    expect(siteTier('github.com.evil.example')).toBe('confirm')
    expect(siteTier('smallshop.example.com')).toBe('confirm')
  })
})

describe('subdomain sites keep parent-domain cookies', () => {
  it('app.example.com keeps .example.com and its own cookies, drops other registrable domains', () => {
    const r = filterStateToSite(
      { cookies: [
        { name: 'a', value: '1', domain: '.example.com' },
        { name: 'b', value: '2', domain: 'app.example.com' },
        { name: 'c', value: '3', domain: 'api.app.example.com' },
        { name: 'd', value: '4', domain: '.other.com' },
      ], origins: [{ origin: 'https://app.example.com', localStorage: [] }, { origin: 'https://example.com', localStorage: [] }] },
      'app.example.com'
    )
    expect(r.state.cookies.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    expect(r.state.origins).toHaveLength(2)
    expect(r.dropped).toBe(1)
  })
})
