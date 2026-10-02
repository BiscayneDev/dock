import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'
import { peekConnectAttempt } from '@/lib/capabilities/store'
import { LoginClient } from './LoginClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Connect a site to Dinghy',
  description: 'Log in to a site yourself in a private browser so Dinghy can use it for you.',
  robots: { index: false, follow: false },
  metadataBase: new URL('https://www.getdinghy.sh'),
}

export default async function ConnectBrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}): Promise<React.JSX.Element> {
  const { t } = await searchParams
  // Read-only check: loading this page never starts a browser.
  const attempt = t ? await peekConnectAttempt(t).catch(() => null) : null
  const site = attempt && attempt.kind === 'browser_session' ? String(attempt.params.site ?? '') : ''
  const live = Boolean(site)

  return (
    <PaperPage
      label="dinghy · connect"
      title="log in to"
      accent={live ? site : 'a site'}
      body="You log in yourself in a private browser. Dinghy never sees your password. It keeps only the login for this one site, encrypted, read-only, for 30 days."
      missing={live ? undefined : 'This link expired or was already used. Ask Dinghy for a fresh one.'}
      fine="Text 'disconnect' and the site name any time to delete it. Banks, exchanges and account pages for Google or Apple can't be connected."
    >
      {live && t ? <LoginClient token={t} site={site} /> : null}
    </PaperPage>
  )
}
