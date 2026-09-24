import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'Connect your GitHub account',
  description:
    'One secure sign-in and Dinghy can read your repos, issues, pull requests and notifications.',
  openGraph: {
    type: 'website',
    title: 'Connect your GitHub account',
    description:
      'One secure sign-in and Dinghy can read your repos, issues, pull requests and notifications.',
    siteName: 'Dinghy',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Dinghy · Your first mate, one text away',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Connect your GitHub account',
    description:
      'One secure sign-in and Dinghy can read your repos, issues, pull requests and notifications.',
    images: ['/api/og'],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default async function ConnectGithubPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}): Promise<React.JSX.Element> {
  const { connect } = await searchParams
  const authHref = connect
    ? `/api/integrations/github/auth?connect=${encodeURIComponent(connect)}`
    : null

  return (
    <PaperPage
      label="dinghy · connect"
      title="connect your"
      accent="github"
      body="One secure sign-in and Dinghy can read your repos, issues, pull requests and notifications."
      action={authHref ? { href: authHref, label: 'connect with github' } : null}
      missing="This link is missing its token. Ask Dinghy for a fresh one."
      fine="You sign in with GitHub itself. Dinghy never sees your password, and only reads from iMessage."
    />
  )
}
