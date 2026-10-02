import { describe, it, expect } from 'vitest'
import { normalizeSite, isDenied, cookieBelongsToSite, filterStateToSite, egressHostsFor } from '@/lib/browser-sessions/policy'

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
    expect(isDenied('google.com')).toBeNull()
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
