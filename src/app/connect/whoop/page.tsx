import type { Metadata } from 'next'
import { PaperPage } from '@/components/brand/PaperPage'

const SITE_URL = 'https://www.getdinghy.sh'

export const metadata: Metadata = {
  title: 'Connect your WHOOP',
  description:
    'One secure sign-in and Dinghy can read your sleep, recovery and activity.',
  openGraph: {
    type: 'website',
    title: 'Connect your WHOOP',
    description:
      'One secure sign-in and Dinghy can read your sleep, recovery and activity.',
    siteName: 'Dinghy',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Dinghy · your first mate lives in your texts',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Connect your WHOOP',
    description:
      'One secure sign-in and Dinghy can read your sleep, recovery and activity.',
    images: ['/api/og'],
  },
  robots: { index: false, follow: false },
  metadataBase: new URL(SITE_URL),
}

export default async function ConnectWHOOPPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}): Promise<React.JSX.Element> {
  const { connect } = await searchParams
  const authHref = connect
    ? `/api/integrations/whoop/auth?connect=${encodeURIComponent(connect)}`
    : null

  return (
    <PaperPage
      label="dinghy · connect"
      title="connect your"
      accent="whoop"
      body="One secure sign-in and Dinghy can read your sleep, recovery and activity."
      action={authHref ? { href: authHref, label: 'connect with whoop' } : null}
      missing="This link is missing its token. Ask Dinghy for a fresh one."
      fine="You sign in with WHOOP itself. Dinghy never sees your password and only reads your data."
    />
  )
}
