import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'Connect your PayBox wallet',
  description:
    'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
  openGraph: {
    type: 'website',
    title: 'Connect your PayBox wallet',
    description:
      'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
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
    title: 'Connect your PayBox wallet',
    description:
      'Sign in with your email + passkey and Dinghy can read your wallet balances. Nothing moves without your passkey.',
    images: ['/api/og'],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default async function ConnectPayboxPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}): Promise<React.JSX.Element> {
  const { connect } = await searchParams
  const authHref = connect
    ? `/api/integrations/paybox/auth?connect=${encodeURIComponent(connect)}`
    : null

  return (
    <PaperPage
      label="dinghy · connect"
      title="connect your"
      accent="paybox"
      body="Sign in with your email and passkey and Dinghy can read your wallet balances. Nothing moves without your passkey."
      action={authHref ? { href: authHref, label: 'connect with paybox' } : null}
      missing="This link is missing its token. Ask Dinghy for a fresh one."
      fine="You approve in PayBox itself. Dinghy never holds your keys."
    />
  )
}
